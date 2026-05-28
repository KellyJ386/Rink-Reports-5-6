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
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { HistoryTab } from "./_components/history-tab"
import { SeveritiesTab } from "./_components/severities-tab"
import { TypesTab } from "./_components/types-tab"
import type {
  EmployeeLite,
  FollowupNoteRow,
  IncidentReportDetail,
  IncidentReportListItem,
  IncidentReportRow,
  IncidentTypeRow,
  SeverityRow,
  Tab,
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
    </div>
  )
}

function Header() {
  return (
    <PageHeader
      title="Incident Reports"
      description="Review submitted incident reports, track follow-ups, and configure types and severity levels. Original reports are immutable."
      actions={<ExportButton moduleKey="incident_reports" />}
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

async function TypesTabLoader({ facilityId }: { facilityId: string }) {
  const supabase = await createClient()
  const [typesRes, severitiesRes] = await Promise.all([
    supabase
      .from("incident_types")
      .select("*")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("incident_severity_levels")
      .select("id")
      .eq("facility_id", facilityId)
      .limit(1),
  ])
  const types = (typesRes.data ?? []) as IncidentTypeRow[]
  const hasAnySeverities = (severitiesRes.data ?? []).length > 0
  return <TypesTab types={types} hasAnySeverities={hasAnySeverities} />
}

async function SeveritiesTabLoader({ facilityId }: { facilityId: string }) {
  const supabase = await createClient()
  const [sevRes, typesRes] = await Promise.all([
    supabase
      .from("incident_severity_levels")
      .select("*")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true })
      .order("display_name", { ascending: true }),
    supabase
      .from("incident_types")
      .select("id")
      .eq("facility_id", facilityId)
      .limit(1),
  ])
  const severities = (sevRes.data ?? []) as SeverityRow[]
  const hasAnyTypes = (typesRes.data ?? []).length > 0
  return <SeveritiesTab severities={severities} hasAnyTypes={hasAnyTypes} />
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
    // Use prefix-LIKE so the text_pattern_ops index can be used.
    q = q.like("location", `${params.location}%`)
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

  const list: IncidentReportListItem[] = reports.map((r) => ({
    ...r,
    type: r.incident_type_id
      ? (typesById.get(r.incident_type_id) ?? null)
      : null,
    severity: r.severity_level_id
      ? (sevById.get(r.severity_level_id) ?? null)
      : null,
    employee: r.employee_id ? (empsById.get(r.employee_id) ?? null) : null,
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
      const [notesRes, reporterRes] = await Promise.all([
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
      ])
      const noteRows = (notesRes.data ?? []) as FollowupNoteRow[]
      const noteEmpIds = Array.from(
        new Set(
          noteRows.map((n) => n.employee_id).filter((x): x is string => !!x),
        ),
      )
      let noteAuthors: EmployeeLite[] = []
      if (noteEmpIds.length > 0) {
        const { data } = await supabase
          .from("employees")
          .select("id, first_name, last_name")
          .in("id", noteEmpIds)
        noteAuthors = (data ?? []) as EmployeeLite[]
      }
      const authorById = new Map(noteAuthors.map((a) => [a.id, a]))

      detail = {
        report: baseReport,
        type: baseReport.incident_type_id
          ? (typesById.get(baseReport.incident_type_id) ?? null)
          : null,
        severity: baseReport.severity_level_id
          ? (sevById.get(baseReport.severity_level_id) ?? null)
          : null,
        employee: (reporterRes.data ?? null) as EmployeeLite | null,
        notes: noteRows.map((n) => ({
          ...n,
          author: n.employee_id
            ? (authorById.get(n.employee_id) ?? null)
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
