import Link from "next/link"

import { SignOutButton } from "@/components/staff/sign-out-button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

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
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports" className="hover:underline">
            Reports
          </Link>{" "}
          / Incident Reports
        </p>
      </div>
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

function statusBadgeClasses(status: string): string {
  switch (status) {
    case "in_review":
      return "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"
    case "resolved":
      return "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
    case "archived":
      return "bg-muted text-muted-foreground"
    default:
      return "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-200"
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

  const { data: perm } = await supabase
    .from("module_permissions")
    .select("can_submit")
    .eq("module_key", "incident_reports")
    .eq("employee_id", employeeRow.id)
    .maybeSingle()

  if (!perm?.can_submit) {
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
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports" className="hover:underline">
            Reports
          </Link>{" "}
          / Incident Reports
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Report an incident
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tell us what happened. You can&apos;t edit a report after you submit
          it.
        </p>
      </div>

      <SubmissionForm
        defaultReporterName={userRow?.full_name ?? ""}
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
          <ul className="flex flex-col divide-y divide-border rounded-xl border bg-card">
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
                <li
                  key={r.id}
                  className="flex flex-col gap-2 px-4 py-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{typeName}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatTimestamp(r.submitted_at, tz)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {severityName ? (
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                        style={
                          severityColor
                            ? {
                                backgroundColor: `${severityColor}20`,
                                color: severityColor,
                              }
                            : undefined
                        }
                      >
                        {severityName}
                      </span>
                    ) : null}
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClasses(
                        r.status
                      )}`}
                    >
                      {statusLabel(r.status)}
                    </span>
                    {r.location ? (
                      <span className="text-xs text-muted-foreground">
                        @ {r.location}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-muted-foreground">{excerpt}</p>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
