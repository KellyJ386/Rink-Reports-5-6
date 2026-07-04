import { MapPin } from "lucide-react"
import Link from "next/link"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { TabNav } from "@/components/ui/tab-nav"
import { ExportButton } from "@/components/admin/export-button"
import { requireAdmin, requireModuleAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { ActivitiesTab } from "./_components/activities-tab"
import { HistoryTab } from "./_components/history-tab"
import { SeveritiesTab } from "./_components/severities-tab"
import { TypesTab } from "./_components/types-tab"
import type {
  ActivityRow,
  ChangeLogRow,
  EmployeeLite,
  FacilitySpaceRow,
  FollowupNoteRow,
  IncidentReportDetail,
  IncidentReportListItem,
  IncidentReportRow,
  IncidentTypeRow,
  SeverityRow,
  Tab,
  WitnessRow,
} from "./types"
import { TABS } from "./types"

export const dynamic = "force-dynamic"

type SearchParams = Promise<{
  tab?: string
  report?: string
  status?: string
  type?: string
  severity?: string
  employee?: string
  location?: string
  from?: string
  to?: string
}>

function asTab(value: string | undefined): Tab {
  const allowed = TABS.map((t) => t.key)
  return (allowed as readonly string[]).includes(value ?? "")
    ? (value as Tab)
    : "history"
}

function tabHref(tab: Tab): string {
  const sp = new URLSearchParams()
  sp.set("tab", tab)
  return `/admin/incident-reports?${sp.toString()}`
}

export const metadata = { title: "Incident Reports | MFO / Rink Reports" }

export default async function IncidentReportsAdminPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireAdmin()
  // Console access alone is not enough: the incident RLS policies gate admin
  // reads (other submitters' reports, the change log) and every write
  // (severities, activities, types, status transitions, follow-up notes) on
  // the module-scoped incident_reports/admin grant. Denying here (with a real
  // /forbidden page) beats rendering a console that lists nothing and whose
  // writes all fail.
  await requireModuleAdmin("incident_reports")
  const params = await searchParams
  const tab = asTab(params.tab)
  const profile = current.profile
  const facilityId = profile?.facility_id ?? null

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No facility yet</CardTitle>
            <CardDescription>
              Create a facility before reviewing incident reports.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/admin/facility">Go to Facility Settings</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <TabBar active={tab} />

      {tab === "history" && (
        <HistoryTabLoader facilityId={facilityId} params={params} />
      )}

      {tab === "types" && <TypesTabLoader facilityId={facilityId} />}

      {tab === "severities" && (
        <SeveritiesTabLoader facilityId={facilityId} />
      )}

      {tab === "activities" && (
        <ActivitiesTabLoader facilityId={facilityId} />
      )}
    </div>
  )
}

function Header() {
  return (
    <PageHeader
      title="Incident Reports"
      description="Review submitted incident reports, track follow-ups, and configure types and severity levels. The Location options live in the shared Facility Spaces list. Original reports are immutable."
      actions={
        <>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/spaces">
              <MapPin />
              Manage locations
            </Link>
          </Button>
          <ExportButton moduleKey="incident_reports" />
        </>
      }
    />
  )
}

function TabBar({ active }: { active: Tab }) {
  return (
    <TabNav
      ariaLabel="Incident reports sections"
      activeHref={tabHref(active)}
      items={TABS.map((t) => ({ label: t.label, href: tabHref(t.key) }))}
    />
  )
}

// ---------------------------------------------------------------------------
// Per-tab loaders
// ---------------------------------------------------------------------------

async function SeveritiesTabLoader({ facilityId }: { facilityId: string }) {
  const supabase = await createClient()
  const { data } = await supabase
    .from("incident_severity_levels")
    .select("*")
    .eq("facility_id", facilityId)
    .order("sort_order", { ascending: true })
    .order("display_name", { ascending: true })
  const severities = (data ?? []) as SeverityRow[]
  return <SeveritiesTab severities={severities} />
}

async function ActivitiesTabLoader({ facilityId }: { facilityId: string }) {
  const supabase = await createClient()
  const { data } = await supabase
    .from("incident_activities")
    .select("*")
    .eq("facility_id", facilityId)
    .order("sort_order", { ascending: true })
    .order("display_name", { ascending: true })
  const activities = (data ?? []) as ActivityRow[]
  return <ActivitiesTab activities={activities} />
}

async function TypesTabLoader({ facilityId }: { facilityId: string }) {
  const supabase = await createClient()
  const { data } = await supabase
    .from("incident_types")
    .select("*")
    .eq("facility_id", facilityId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
  const types = (data ?? []) as IncidentTypeRow[]
  return <TypesTab types={types} />
}

async function HistoryTabLoader({
  facilityId,
  params,
}: {
  facilityId: string
  params: {
    report?: string
    status?: string
    type?: string
    severity?: string
    employee?: string
    location?: string
    from?: string
    to?: string
  }
}) {
  const supabase = await createClient()

  // Lookups for filter dropdowns + badge rendering.
  const [typesRes, sevRes, empsRes] = await Promise.all([
    supabase
      .from("incident_types")
      .select("id, name, color, slug")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("incident_severity_levels")
      .select("id, key, display_name, color")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("employees")
      .select("id, first_name, last_name")
      .eq("facility_id", facilityId)
      .order("last_name", { ascending: true }),
  ])
  const types = (typesRes.data ?? []) as Array<
    Pick<IncidentTypeRow, "id" | "name" | "color" | "slug">
  >
  const severities = (sevRes.data ?? []) as Array<
    Pick<SeverityRow, "id" | "key" | "display_name" | "color">
  >
  const employees = (empsRes.data ?? []) as EmployeeLite[]

  // Reports list query
  let q = supabase
    .from("incident_reports")
    .select("*")
    .eq("facility_id", facilityId)
    .order("submitted_at", { ascending: false })
    .limit(200)
  if (params.status) q = q.eq("status", params.status)
  if (params.type) q = q.eq("incident_type_id", params.type)
  if (params.severity) q = q.eq("severity_level_id", params.severity)
  if (params.employee) q = q.eq("employee_id", params.employee)
  if (params.location) {
    // Locations moved to incident_report_spaces + location_other in migration
    // 103; the legacy `location` column only exists on pre-redesign rows.
    // Match the prefix against linked space names, the "Other" free text, and
    // the legacy column.
    const likePattern = `${params.location.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    const { data: spaceMatches } = await supabase
      .from("facility_spaces")
      .select("id")
      .eq("facility_id", facilityId)
      .ilike("name", likePattern)
    const matchedSpaceIds = (spaceMatches ?? []).map((s) => s.id)
    let matchedIncidentIds: string[] = []
    if (matchedSpaceIds.length > 0) {
      const { data: links } = await supabase
        .from("incident_report_spaces")
        .select("incident_id")
        .eq("facility_id", facilityId)
        .in("space_id", matchedSpaceIds)
      matchedIncidentIds = Array.from(
        new Set((links ?? []).map((l) => l.incident_id)),
      )
    }
    // PostgREST `or` values are comma/paren-sensitive — double-quote the
    // pattern and escape embedded backslashes/quotes.
    const quoted = `"${likePattern.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
    const ors = [`location_other.ilike.${quoted}`, `location.ilike.${quoted}`]
    if (matchedIncidentIds.length > 0) {
      ors.push(`id.in.(${matchedIncidentIds.join(",")})`)
    }
    q = q.or(ors.join(","))
  }
  if (params.from) q = q.gte("submitted_at", `${params.from}T00:00:00.000Z`)
  if (params.to) q = q.lte("submitted_at", `${params.to}T23:59:59.999Z`)

  const { data: reportsRaw } = await q
  const reports = (reportsRaw ?? []) as IncidentReportRow[]

  const typesById = new Map(types.map((t) => [t.id, t]))
  const sevById = new Map(severities.map((s) => [s.id, s]))

  // Resolve listed report employees in a single round-trip.
  const empIds = Array.from(
    new Set(
      reports.map((r) => r.employee_id).filter((x): x is string => !!x),
    ),
  )
  let listedEmployees: EmployeeLite[] = []
  if (empIds.length > 0) {
    const { data } = await supabase
      .from("employees")
      .select("id, first_name, last_name")
      .in("id", empIds)
    listedEmployees = (data ?? []) as EmployeeLite[]
  }
  const empsById = new Map(listedEmployees.map((e) => [e.id, e]))

  // Resolve linked facility-space names for the Location column (new reports
  // store locations in incident_report_spaces + location_other; the legacy
  // `location` column only exists on pre-redesign rows).
  const spaceNamesByReport = new Map<string, string[]>()
  if (reports.length > 0) {
    const [{ data: linkRows }, { data: spaceRows }] = await Promise.all([
      supabase
        .from("incident_report_spaces")
        .select("incident_id, space_id")
        .in(
          "incident_id",
          reports.map((r) => r.id),
        ),
      supabase
        .from("facility_spaces")
        .select("id, name")
        .eq("facility_id", facilityId),
    ])
    const spaceNameById = new Map(
      (spaceRows ?? []).map((s) => [s.id, s.name]),
    )
    for (const link of linkRows ?? []) {
      const name = spaceNameById.get(link.space_id)
      if (!name) continue
      const names = spaceNamesByReport.get(link.incident_id) ?? []
      names.push(name)
      spaceNamesByReport.set(link.incident_id, names)
    }
  }
  const locationLabel = (r: IncidentReportRow): string | null =>
    [...(spaceNamesByReport.get(r.id) ?? []), r.location_other]
      .filter(Boolean)
      .join(", ") ||
    r.location ||
    null

  const list: IncidentReportListItem[] = reports.map((r) => ({
    ...r,
    type: r.incident_type_id
      ? (typesById.get(r.incident_type_id) ?? null)
      : null,
    severity: r.severity_level_id
      ? (sevById.get(r.severity_level_id) ?? null)
      : null,
    employee: r.employee_id ? (empsById.get(r.employee_id) ?? null) : null,
    locationLabel: locationLabel(r),
  }))

  // Drilldown detail loader
  let detail: IncidentReportDetail | null = null
  if (params.report) {
    let baseReport = reports.find((r) => r.id === params.report) ?? null
    if (!baseReport) {
      const { data } = await supabase
        .from("incident_reports")
        .select("*")
        .eq("facility_id", facilityId)
        .eq("id", params.report)
        .maybeSingle()
      baseReport = (data ?? null) as IncidentReportRow | null
    }
    if (baseReport) {
      const [notesRes, reporterRes, spaceLinksRes, witnessesRes, changeLogRes] =
        await Promise.all([
          supabase
            .from("incident_followup_notes")
            .select("*")
            .eq("incident_id", baseReport.id)
            .order("created_at", { ascending: true }),
          baseReport.employee_id
            ? supabase
                .from("employees")
                .select("id, first_name, last_name")
                .eq("id", baseReport.employee_id)
                .maybeSingle()
            : Promise.resolve({ data: null }),
          supabase
            .from("incident_report_spaces")
            .select("space_id")
            .eq("incident_id", baseReport.id),
          supabase
            .from("incident_witnesses")
            .select("*")
            .eq("incident_id", baseReport.id)
            .order("sort_order", { ascending: true }),
          supabase
            .from("incident_change_log")
            .select("*")
            .eq("incident_id", baseReport.id)
            .order("created_at", { ascending: true }),
        ])

      const noteRows = (notesRes.data ?? []) as FollowupNoteRow[]
      const witnesses = (witnessesRes.data ?? []) as WitnessRow[]
      const changeRows = (changeLogRes.data ?? []) as ChangeLogRow[]

      // Resolve facility-space names for the linked spaces.
      const spaceIds = (
        (spaceLinksRes.data ?? []) as Array<{ space_id: string }>
      ).map((r) => r.space_id)
      let spaces: Array<Pick<FacilitySpaceRow, "id" | "name">> = []
      if (spaceIds.length > 0) {
        const { data } = await supabase
          .from("facility_spaces")
          .select("id, name")
          .in("id", spaceIds)
        spaces = (data ?? []) as Array<Pick<FacilitySpaceRow, "id" | "name">>
      }

      // Resolve the activity row, if any.
      let activity: Pick<ActivityRow, "id" | "display_name" | "color"> | null =
        null
      if (baseReport.activity_id) {
        const { data } = await supabase
          .from("incident_activities")
          .select("id, display_name, color")
          .eq("id", baseReport.activity_id)
          .maybeSingle()
        activity = (data ?? null) as Pick<
          ActivityRow,
          "id" | "display_name" | "color"
        > | null
      }

      // Resolve author employees for notes + change log in one round-trip.
      const authorEmpIds = Array.from(
        new Set(
          [
            ...noteRows.map((n) => n.employee_id),
            ...changeRows.map((c) => c.employee_id),
          ].filter((x): x is string => !!x),
        ),
      )
      let authors: EmployeeLite[] = []
      if (authorEmpIds.length > 0) {
        const { data } = await supabase
          .from("employees")
          .select("id, first_name, last_name")
          .in("id", authorEmpIds)
        authors = (data ?? []) as EmployeeLite[]
      }
      const authorById = new Map(authors.map((a) => [a.id, a]))

      detail = {
        report: baseReport,
        type: baseReport.incident_type_id
          ? (typesById.get(baseReport.incident_type_id) ?? null)
          : null,
        severity: baseReport.severity_level_id
          ? (sevById.get(baseReport.severity_level_id) ?? null)
          : null,
        activity,
        spaces,
        witnesses,
        employee: (reporterRes.data ?? null) as EmployeeLite | null,
        notes: noteRows.map((n) => ({
          ...n,
          author: n.employee_id
            ? (authorById.get(n.employee_id) ?? null)
            : null,
        })),
        changeLog: changeRows.map((c) => ({
          ...c,
          author: c.employee_id
            ? (authorById.get(c.employee_id) ?? null)
            : null,
        })),
      }
    }
  }

  // Build back href (strips report param, keeps filters).
  const backSp = new URLSearchParams()
  backSp.set("tab", "history")
  for (const k of [
    "status",
    "type",
    "severity",
    "employee",
    "location",
    "from",
    "to",
  ] as const) {
    const v = params[k]
    if (v) backSp.set(k, v)
  }
  const backHref = `/admin/incident-reports?${backSp.toString()}`

  return (
    <HistoryTab
      list={list}
      detail={detail}
      backHref={backHref}
      types={types}
      severities={severities}
      employees={employees}
      params={params}
    />
  )
}
