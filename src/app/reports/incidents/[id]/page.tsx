import Link from "next/link"
import { notFound } from "next/navigation"

import { Breadcrumb } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { updateIncidentReport } from "../actions"
import {
  ACTIVITY_OTHER,
  SubmissionForm,
  type IncidentFormInitial,
} from "../_components/submission-form"

export const dynamic = "force-dynamic"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Reconstruct a datetime-local string (no timezone) from a stored ISO. The
 * submit path stores `new Date(localString).toISOString()`, so the wall-clock
 * the reporter entered lives in the ISO's UTC components — read them back.
 */
function isoToDateTimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  )
}

/** Whether the 24h edit window is still open. Kept out of the component body
 * so the `Date.now()` read isn't flagged by the render-purity lint rule. */
function isWindowOpen(endsAt: string): boolean {
  return new Date(endsAt).getTime() > Date.now()
}

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    })
  } catch {
    return iso
  }
}

export default async function IncidentReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ saved?: string }>
}) {
  const { id } = await params
  const { saved } = await searchParams
  if (!UUID_RE.test(id)) notFound()

  const current = await requireUser()
  const supabase = await createClient()

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  // RLS scopes this to the submitter (or an admin); a non-owner staffer reads
  // nothing back and lands on notFound().
  const { data: report } = await supabase
    .from("incident_reports")
    .select(
      "id, facility_id, employee_id, edit_window_ends_at, occurred_at, submitted_at, status, severity_level_id, incident_type_id, activity_id, activity_other, location_other, immediate_actions, reporter_name, reporter_phone, description, ambulance_flag, persons_involved, follow_up_required",
    )
    .eq("id", id)
    .maybeSingle()

  if (!report) notFound()

  const [
    { data: spaceLinks },
    { data: witnessRows },
    { data: severityLevels },
    { data: activityRows },
    { data: spaceRows },
    { data: incidentTypeRows },
  ] = await Promise.all([
    supabase
      .from("incident_report_spaces")
      .select("space_id")
      .eq("incident_id", id),
    supabase
      .from("incident_witnesses")
      .select("name, phone, email, statement")
      .eq("incident_id", id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("incident_severity_levels")
      .select("id, display_name, sort_order, is_active")
      .eq("facility_id", report.facility_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("display_name", { ascending: true }),
    supabase
      .from("incident_activities")
      .select("id, display_name, sort_order, is_active")
      .eq("facility_id", report.facility_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("display_name", { ascending: true }),
    supabase
      .from("facility_spaces")
      .select("id, name, sort_order, is_active")
      .eq("facility_id", report.facility_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("incident_types")
      .select("id, name, sort_order, is_active")
      .eq("facility_id", report.facility_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
  ])

  const severities = (severityLevels ?? []).map((s) => ({
    id: s.id,
    display_name: s.display_name,
  }))
  const incidentTypes = (incidentTypeRows ?? []).map((t) => ({
    id: t.id,
    name: t.name,
  }))
  const activities = (activityRows ?? []).map((a) => ({
    id: a.id,
    display_name: a.display_name,
  }))
  const spaces = (spaceRows ?? []).map((s) => ({ id: s.id, name: s.name }))

  const selectedSpaceIds = (spaceLinks ?? []).map((l) => l.space_id)
  const witnesses = (witnessRows ?? []).map((w) => ({
    name: w.name ?? "",
    phone: w.phone ?? "",
    email: w.email ?? "",
    statement: w.statement ?? "",
  }))

  const isOwner = report.employee_id === employeeRow?.id
  const canEdit = isOwner && isWindowOpen(report.edit_window_ends_at)

  const breadcrumb = (
    <Breadcrumb
      segments={[
        { label: "Reports", href: "/reports" },
        { label: "Incident Reports", href: "/reports/incidents" },
        { label: "Report" },
      ]}
    />
  )

  if (!canEdit) {
    // Read-only view (window closed or not the owner).
    const severityName =
      severities.find((s) => s.id === report.severity_level_id)?.display_name ??
      "—"
    const activityName = report.activity_id
      ? (activities.find((a) => a.id === report.activity_id)?.display_name ??
        "—")
      : report.activity_other || "—"
    const spaceNames = selectedSpaceIds
      .map((sid) => spaces.find((s) => s.id === sid)?.name)
      .filter((n): n is string => !!n)

    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <PageHeader
          variant="display"
          module="incidents"
          breadcrumb={breadcrumb}
          title="Incident Report"
        />
        <Card>
          <CardContent className="flex flex-col gap-3 py-6 text-sm">
            <p className="text-muted-foreground">
              {isOwner
                ? "The 24-hour edit window for this report has closed, so it’s now read-only."
                : "This report is read-only."}
            </p>
            <Row label="Severity" value={severityName} />
            <Row label="Activity" value={activityName} />
            <Row
              label="Facility spaces"
              value={
                [...spaceNames, report.location_other]
                  .filter(Boolean)
                  .join(", ") || "—"
              }
            />
            <Row label="When it happened" value={fmt(report.occurred_at)} />
            <Row label="Reported at" value={fmt(report.submitted_at)} />
            <Row label="Reporter" value={report.reporter_name} />
            <Row label="Phone" value={report.reporter_phone ?? "—"} />
            <Row
              label="Ambulance called"
              value={report.ambulance_flag ? "Yes" : "No"}
            />
            <Row
              label="People involved"
              value={
                report.persons_involved === null
                  ? "—"
                  : String(report.persons_involved)
              }
            />
            <Row
              label="Follow-up required"
              value={report.follow_up_required ? "Yes" : "No"}
            />
            <div className="flex flex-col gap-1 border-b border-border pb-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Description
              </span>
              <p className="whitespace-pre-wrap">{report.description}</p>
            </div>
            {report.immediate_actions ? (
              <div className="flex flex-col gap-1 border-b border-border pb-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  Immediate actions taken
                </span>
                <p className="whitespace-pre-wrap">
                  {report.immediate_actions}
                </p>
              </div>
            ) : null}
            {witnesses.length > 0 ? (
              <div className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  Witnesses
                </span>
                {witnesses.map((w, i) => (
                  <div key={i} className="rounded-md border p-2">
                    <span className="font-medium">{w.name}</span>
                    <div className="text-muted-foreground text-xs">
                      {[w.phone, w.email].filter(Boolean).join(" · ")}
                    </div>
                    {w.statement ? (
                      <p className="mt-1 whitespace-pre-wrap">{w.statement}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
        <Button asChild variant="outline" className="h-12 w-full text-base">
          <Link href="/reports/incidents">Back to incident reports</Link>
        </Button>
      </div>
    )
  }

  const initial: IncidentFormInitial = {
    occurredAtLocal: isoToDateTimeLocal(report.occurred_at),
    severityLevelId: report.severity_level_id ?? "",
    incidentTypeId: report.incident_type_id ?? "",
    activityValue: report.activity_id
      ? report.activity_id
      : report.activity_other
        ? ACTIVITY_OTHER
        : "",
    activityOther: report.activity_other ?? "",
    selectedSpaceIds,
    otherSpace: !!report.location_other,
    locationOther: report.location_other ?? "",
    description: report.description,
    immediateActions: report.immediate_actions ?? "",
    witnesses,
    ambulanceFlag: report.ambulance_flag,
    personsInvolved:
      report.persons_involved === null ? "" : String(report.persons_involved),
    followUpRequired: report.follow_up_required,
  }

  const updateAction = updateIncidentReport.bind(null, report.id)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <PageHeader
        variant="display"
        module="incidents"
        breadcrumb={breadcrumb}
        title="Edit Incident Report"
      />

      {saved ? (
        <div
          role="status"
          className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-foreground"
        >
          Changes saved. You can keep editing until the 24-hour window closes (
          {fmt(report.edit_window_ends_at)}).
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Editable until {fmt(report.edit_window_ends_at)}.
        </p>
      )}

      <SubmissionForm
        mode="edit"
        action={updateAction}
        initial={initial}
        severityLevels={severities}
        activities={activities}
        spaces={spaces}
        incidentTypes={incidentTypes}
      />
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
