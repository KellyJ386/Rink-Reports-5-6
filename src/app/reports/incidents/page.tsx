import { SignOutButton } from "@/components/staff/sign-out-button"
import { Badge, type BadgeProps } from "@/components/ui/badge"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { DataList, DataListRow } from "@/components/ui/data-table"
import { PageHeader } from "@/components/ui/page-header"
import { SeverityPill } from "@/components/ui/severity"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"

import { SubmissionForm } from "./_components/submission-form"
import type { IncidentStatus } from "./types"

export const dynamic = "force-dynamic"

type RecentRow = {
  id: string
  submitted_at: string
  occurred_at: string
  status: string
  description: string
  location: string | null
  incident_types: { name: string } | null
  incident_severity_levels: {
    display_name: string
    color: string | null
  } | null
}

function NotAvailable({
  title,
  description,
  showSignOut = false,
}: {
  title: string
  description: string
  showSignOut?: boolean
}) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <Breadcrumb
        segments={[
          { label: "Reports", href: "/reports" },
          { label: "Incident Reports" },
        ]}
      />
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {showSignOut ? (
          <CardContent>
            <SignOutButton />
          </CardContent>
        ) : null}
      </Card>
    </div>
  )
}

function statusLabel(status: string): string {
  const map: Record<IncidentStatus, string> = {
    submitted: "Submitted",
    in_review: "In review",
    resolved: "Resolved",
    archived: "Archived",
  }
  return map[status as IncidentStatus] ?? status
}

function statusBadgeVariant(status: string): BadgeProps["variant"] {
  switch (status) {
    case "in_review":
      return "warning"
    case "resolved":
      return "success"
    case "archived":
      return "outline"
    default:
      return "info"
  }
}

function formatTimestamp(iso: string, timezone: string | null): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: timezone || undefined,
      dateStyle: "medium",
      timeStyle: "short",
    })
  } catch {
    return new Date(iso).toLocaleString()
  }
}

export default async function IncidentsHomePage() {
  const current = await requireUser()
  const supabase = await createClient()

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  if (!employeeRow) {
    return (
      <NotAvailable
        title="Account not ready"
        description="Your account isn't fully set up yet. Contact your administrator."
        showSignOut
      />
    )
  }

  if (!(await currentUserCan(supabase, "incident_reports", "submit"))) {
    return (
      <NotAvailable
        title="No access"
        description="You don't have permission to submit incident reports."
      />
    )
  }

  const [
    { data: incidentTypes },
    { data: severityLevels },
    { data: userRow },
    { data: facility },
  ] = await Promise.all([
    supabase
      .from("incident_types")
      .select("id, name, sort_order, is_active")
      .eq("facility_id", employeeRow.facility_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("incident_severity_levels")
      .select("id, display_name, sort_order, is_active")
      .eq("facility_id", employeeRow.facility_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("display_name", { ascending: true }),
    supabase
      .from("users")
      .select("full_name, phone")
      .eq("id", current.authUser.id)
      .maybeSingle(),
    supabase
      .from("facilities")
      .select("timezone")
      .eq("id", employeeRow.facility_id)
      .maybeSingle(),
  ])

  const types = incidentTypes ?? []
  const severities = severityLevels ?? []

  if (types.length === 0 || severities.length === 0) {
    return (
      <NotAvailable
        title="Not configured yet"
        description="Incident reporting isn't configured yet for this facility. Talk to your administrator."
      />
    )
  }

  // Recent submissions, last 30 days, RLS scopes to this submitter.
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const { data: recentRaw } = await supabase
    .from("incident_reports")
    .select(
      "id, submitted_at, occurred_at, status, description, location, incident_types(name), incident_severity_levels(display_name, color)"
    )
    .eq("employee_id", employeeRow.id)
    .gte("submitted_at", since.toISOString())
    .order("submitted_at", { ascending: false })
    .limit(10)

  const recent = (recentRaw ?? []) as unknown as RecentRow[]
  const tz = facility?.timezone ?? null

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <PageHeader
        variant="display"
        module="incidents"
        breadcrumb={
          <Breadcrumb
            segments={[
              { label: "Reports", href: "/reports" },
              { label: "Incident Reports" },
            ]}
          />
        }
        title="Incident Reports"
      />

      <SubmissionForm
        defaultReporterName=""
        defaultReporterPhone={userRow?.phone ?? ""}
        incidentTypes={types.map((t) => ({ id: t.id, name: t.name }))}
        severityLevels={severities.map((s) => ({
          id: s.id,
          display_name: s.display_name,
        }))}
      />

      {recent.length > 0 ? (
        <section className="mt-2 flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Your recent reports
          </h2>
          <p className="text-xs text-muted-foreground">Last 30 days</p>
          <DataList>
            {recent.map((r) => {
              const typeName = r.incident_types?.name ?? "Incident"
              const severityName =
                r.incident_severity_levels?.display_name ?? null
              const severityColor = r.incident_severity_levels?.color ?? null
              const excerpt =
                r.description.length > 140
                  ? `${r.description.slice(0, 140).trimEnd()}…`
                  : r.description
              return (
                <DataListRow key={r.id} as="div" className="flex-col items-stretch gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{typeName}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatTimestamp(r.submitted_at, tz)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {severityName ? (
                      <SeverityPill color={severityColor}>
                        {severityName}
                      </SeverityPill>
                    ) : null}
                    <Badge variant={statusBadgeVariant(r.status)}>
                      {statusLabel(r.status)}
                    </Badge>
                    {r.location ? (
                      <span className="text-xs text-muted-foreground">
                        @ {r.location}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-muted-foreground">{excerpt}</p>
                </DataListRow>
              )
            })}
          </DataList>
        </section>
      ) : null}
    </div>
  )
}
