import { AlertTriangle, CheckCircle2, ClipboardList } from "lucide-react"

import { SignOutButton } from "@/components/staff/sign-out-button"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { SectionCard } from "@/components/ui/section-card"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import type { Tables } from "@/types/database"

import {
  getAssignmentRecord,
  type AssignmentRecordDay,
} from "../_lib/assignments"

export const dynamic = "force-dynamic"

// Cap on how many recent submissions to surface. Daily reports auto-purge
// after 14 days, so this is effectively "everything the user can still see".
const HISTORY_LIMIT = 100

type SubmissionRow = Pick<
  Tables<"daily_report_submissions">,
  "id" | "area_id" | "template_id" | "employee_id" | "submitted_at"
>

type HistoryItem = {
  id: string
  submittedAt: string
  areaName: string | null
  areaColor: string | null
  templateName: string | null
  submittedBy: string | null
  checkedCount: number
  itemCount: number
}

function formatRecordDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(`${iso}T12:00:00Z`))
  } catch {
    return iso
  }
}

function names(people: { name: string }[]): string {
  return people.map((p) => p.name).join(", ")
}

/**
 * Frozen assignment record for closed days (D5/D8): per area, a permanent
 * "Completed by X" or "Assigned to X — not completed" flag, from the
 * day-close snapshots. Days/areas that were open (unassigned) have no
 * snapshot rows and render exactly as before the feature.
 */
function AssignmentRecord({ days }: { days: AssignmentRecordDay[] }) {
  if (days.length === 0) return null
  return (
    <Card className="gap-4 py-5">
      <h2 className="px-6 text-lg font-semibold tracking-tight">
        Assignment record
      </h2>
      <div className="flex flex-col gap-4 px-6">
        {days.map((day) => (
          <div key={day.date} className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold text-muted-foreground">
              {formatRecordDate(day.date)}
            </h3>
            <ul className="flex flex-col divide-y divide-border rounded-lg border bg-background">
              {day.areas.map((area) => (
                <li
                  key={area.areaId}
                  className="flex items-start gap-3 px-4 py-2.5"
                >
                  {area.completed ? (
                    <CheckCircle2
                      aria-hidden
                      className="mt-0.5 h-4 w-4 shrink-0 text-success"
                    />
                  ) : (
                    <AlertTriangle
                      aria-hidden
                      className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                    />
                  )}
                  <span className="flex min-w-0 flex-col text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      {area.areaColor ? (
                        <span
                          aria-hidden
                          className="inline-block size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: area.areaColor }}
                        />
                      ) : null}
                      {area.areaName}
                    </span>
                    {area.completed ? (
                      <span className="text-muted-foreground">
                        Completed by{" "}
                        {names(area.completedBy) || "an unrecorded submitter"}
                      </span>
                    ) : (
                      <span className="text-destructive">
                        Assigned to {names(area.assignees) || "—"} — not
                        completed
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  )
}

function formatTimestamp(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso))
  } catch {
    return new Date(iso).toISOString()
  }
}

export default async function DailyReportHistoryPage() {
  const current = await requireUser()
  const supabase = await createClient()

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <PageHeader
        variant="display"
        module="daily"
        breadcrumb={
          <Breadcrumb
            segments={[
              { label: "Reports", href: "/reports" },
              { label: "Daily Reports", href: "/reports/daily" },
              { label: "History" },
            ]}
          />
        }
        title="Daily Report History"
        description="Recent daily reports for your facility. Read-only."
      />
      {children}
    </div>
  )

  if (!employeeRow) {
    return shell(
      <Card>
        <CardHeader>
          <CardTitle>Account not ready</CardTitle>
          <CardDescription>
            Your account is being set up. Contact your administrator.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutButton />
        </CardContent>
      </Card>
    )
  }

  // RLS (migration 90, daily_report_submissions_select) restricts these rows to
  // the user's facility, the modules they can view, and only the areas they have
  // access to. We scope by facility_id explicitly (defense in depth / index use)
  // and rely on the policy for the per-area gate — never trust a client-supplied
  // facility id, and never use the service role here.
  const { data: subsRaw } = await supabase
    .from("daily_report_submissions")
    .select("id, area_id, template_id, employee_id, submitted_at")
    .eq("facility_id", employeeRow.facility_id)
    .order("submitted_at", { ascending: false })
    .limit(HISTORY_LIMIT)
  const subs = (subsRaw ?? []) as SubmissionRow[]

  // Facility timezone for rendering wall-clock timestamps server-side.
  const { data: facility } = await supabase
    .from("facilities")
    .select("timezone")
    .eq("id", employeeRow.facility_id)
    .maybeSingle()
  const timeZone = facility?.timezone ?? "UTC"

  // Resolve labels in batched lookups (avoid N+1). RLS scopes each of these to
  // the same facility/visibility boundary.
  const areaIds = Array.from(new Set(subs.map((s) => s.area_id)))
  const templateIds = Array.from(new Set(subs.map((s) => s.template_id)))
  const employeeIds = Array.from(
    new Set(subs.map((s) => s.employee_id).filter((x): x is string => !!x))
  )
  const subIds = subs.map((s) => s.id)

  const [areasRes, templatesRes, employeesRes, itemsRes] = await Promise.all([
    areaIds.length
      ? supabase
          .from("daily_report_areas")
          .select("id, name, color")
          .in("id", areaIds)
      : Promise.resolve({ data: [] }),
    templateIds.length
      ? supabase
          .from("daily_report_templates")
          .select("id, name")
          .in("id", templateIds)
      : Promise.resolve({ data: [] }),
    employeeIds.length
      ? supabase
          .from("employees")
          .select("id, first_name, last_name")
          .in("id", employeeIds)
      : Promise.resolve({ data: [] }),
    subIds.length
      ? supabase
          .from("daily_report_submission_items")
          .select("submission_id, is_checked")
          .in("submission_id", subIds)
      : Promise.resolve({ data: [] }),
  ])

  const areaById = new Map(
    (areasRes.data ?? []).map((a) => [a.id, a])
  )
  const templateById = new Map(
    (templatesRes.data ?? []).map((t) => [t.id, t])
  )
  const employeeById = new Map(
    (employeesRes.data ?? []).map((e) => [e.id, e])
  )

  const itemAgg = new Map<string, { total: number; checked: number }>()
  for (const r of itemsRes.data ?? []) {
    const cur = itemAgg.get(r.submission_id) ?? { total: 0, checked: 0 }
    cur.total += 1
    if (r.is_checked) cur.checked += 1
    itemAgg.set(r.submission_id, cur)
  }

  const items: HistoryItem[] = subs.map((s) => {
    const area = areaById.get(s.area_id) ?? null
    const template = templateById.get(s.template_id) ?? null
    const emp = s.employee_id ? employeeById.get(s.employee_id) ?? null : null
    const counts = itemAgg.get(s.id) ?? { total: 0, checked: 0 }
    return {
      id: s.id,
      submittedAt: s.submitted_at,
      areaName: area?.name ?? null,
      areaColor: area?.color ?? null,
      templateName: template?.name ?? null,
      submittedBy: emp ? `${emp.first_name} ${emp.last_name}`.trim() : null,
      checkedCount: counts.checked,
      itemCount: counts.total,
    }
  })

  // Frozen assignment record for closed days (empty when routing was never
  // enabled — the page then renders exactly as before the feature).
  const record = await getAssignmentRecord()

  if (items.length === 0) {
    return shell(
      <>
        <AssignmentRecord days={record} />
        <SectionCard className="items-center gap-3 py-12 text-center">
          <span
            aria-hidden
            className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            <ClipboardList className="h-6 w-6" />
          </span>
          <h2 className="text-lg font-semibold tracking-tight">
            No reports yet
          </h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Once daily reports are submitted for areas you can access,
            they&apos;ll appear here. Reports auto-delete after 14 days.
          </p>
        </SectionCard>
      </>
    )
  }

  return shell(
    <>
      <AssignmentRecord days={record} />
      <Card className="gap-0 py-0">
        <ul className="flex flex-col divide-y divide-border">
          {items.map((it) => (
          <li
            key={it.id}
            className="flex flex-col gap-2 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2">
                {it.areaColor ? (
                  <span
                    aria-hidden
                    className="inline-block size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: it.areaColor }}
                  />
                ) : null}
                <span className="truncate text-base font-medium text-foreground">
                  {it.areaName ?? "Unknown area"}
                </span>
                {it.templateName ? (
                  <span className="truncate text-sm text-muted-foreground">
                    · {it.templateName}
                  </span>
                ) : null}
              </div>
              <div className="text-sm text-muted-foreground">
                {formatTimestamp(it.submittedAt, timeZone)}
                {it.submittedBy ? <> · {it.submittedBy}</> : null}
              </div>
            </div>
            {it.itemCount > 0 ? (
              <span className="shrink-0 self-start rounded-full bg-muted px-2.5 py-1 text-xs font-medium tabular-nums text-muted-foreground sm:self-auto">
                {it.checkedCount}/{it.itemCount} complete
              </span>
            ) : null}
          </li>
        ))}
        </ul>
      </Card>
    </>
  )
}
