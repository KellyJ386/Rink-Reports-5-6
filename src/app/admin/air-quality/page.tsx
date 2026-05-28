import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ExportButton } from "@/components/admin/export-button"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

import { ComplianceTab } from "./_components/compliance-tab"
import { HistoryTab } from "./_components/history-tab"
import { SettingsTab } from "./_components/settings-tab"
import { SetupTab } from "./_components/setup-tab"
import type {
  ComplianceData,
  ComplianceRuleRow,
  EmployeeLite,
  EquipmentRow,
  FollowupNoteRow,
  LocationRow,
  LocationWithCounts,
  ReadingRow,
  ReadingTypeRow,
  ReportDetailData,
  ReportListItem,
  ReportRow,
  SetupData,
  SettingsRow,
  Tab,
  ThresholdRow,
} from "./types"
import { TABS, asTab } from "./types"

export const dynamic = "force-dynamic"

type SearchParams = Promise<{
  tab?: string
  location?: string
  report?: string
  employee?: string
  equipment?: string
  reading_type?: string
  exceedance?: string
  jurisdiction?: string
  from?: string
  to?: string
  q?: string
}>

function tabHref(tab: Tab): string {
  const sp = new URLSearchParams()
  sp.set("tab", tab)
  return `/admin/air-quality?${sp.toString()}`
}

function defaultDateFrom(): string {
  const d = new Date()
  d.setDate(d.getDate() - 14)
  return d.toISOString().slice(0, 10)
}

export const metadata = { title: "Air Quality | MFO / Rink Reports" }

export default async function AirQualityAdminPage({
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
              Create a facility before configuring air quality reports.
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

      {tab === "setup" && (
        <SetupTabLoader facilityId={facilityId} params={params} />
      )}
      {tab === "compliance" && (
        <ComplianceTabLoader facilityId={facilityId} params={params} />
      )}
      {tab === "history" && (
        <HistoryTabLoader facilityId={facilityId} params={params} />
      )}
      {tab === "settings" && <SettingsTabLoader facilityId={facilityId} />}
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Air Quality</h1>
        <p className="text-muted-foreground text-sm">
          Configure locations, equipment, reading types, thresholds, and
          compliance rules. Review submitted reports and add follow-up notes.
          Original reports are immutable.
        </p>
      </div>
      <ExportButton moduleKey="air_quality" />
    </div>
  )
}

function TabBar({ active }: { active: Tab }) {
  return (
    <nav className="flex flex-wrap items-center gap-1 rounded-md border p-1">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={tabHref(t.key)}
          className={cn(
            "rounded px-3 py-1.5 text-sm font-medium transition-colors",
            active === t.key
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Setup tab loader
// ---------------------------------------------------------------------------

async function SetupTabLoader({
  facilityId,
  params,
}: {
  facilityId: string
  params: { location?: string }
}) {
  const supabase = await createClient()
  const [locsRes, equipRes, rtRes, thresholdsRes] = await Promise.all([
    supabase
      .from("air_quality_locations")
      .select("*")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("air_quality_equipment")
      .select("*")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("air_quality_reading_types")
      .select("*")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true }),
    supabase
      .from("air_quality_thresholds")
      .select("*")
      .eq("facility_id", facilityId)
      .order("created_at", { ascending: true }),
  ])

  const locations = (locsRes.data ?? []) as LocationRow[]
  const allEquipment = (equipRes.data ?? []) as EquipmentRow[]
  const readingTypes = (rtRes.data ?? []) as ReadingTypeRow[]
  const thresholds = (thresholdsRes.data ?? []) as ThresholdRow[]

  const equipByLoc = new Map<string, number>()
  for (const e of allEquipment) {
    if (!e.location_id) continue
    equipByLoc.set(e.location_id, (equipByLoc.get(e.location_id) ?? 0) + 1)
  }

  const locationsWithCounts: LocationWithCounts[] = locations.map((l) => ({
    ...l,
    equipment_count: equipByLoc.get(l.id) ?? 0,
  }))

  const facilityEquipment = allEquipment.filter((e) => e.location_id === null)

  let detail = null
  const activeLocationId = params.location ?? null
  if (activeLocationId) {
    const loc = locations.find((l) => l.id === activeLocationId) ?? null
    if (loc) {
      const locEquipment = allEquipment.filter(
        (e) => e.location_id === loc.id,
      )
      detail = { location: loc, equipment: locEquipment }
    }
  }

  const data: SetupData = {
    locations: locationsWithCounts,
    facilityEquipment,
    readingTypes,
    thresholds,
    detail,
    activeLocationId,
    allLocations: locations,
  }

  return <SetupTab data={data} />
}

// ---------------------------------------------------------------------------
// Compliance tab loader
// ---------------------------------------------------------------------------

async function ComplianceTabLoader({
  facilityId,
  params,
}: {
  facilityId: string
  params: { jurisdiction?: string }
}) {
  const supabase = await createClient()
  const [rulesRes, settingsRes] = await Promise.all([
    supabase
      .from("air_quality_compliance_rules")
      .select("*")
      .eq("facility_id", facilityId)
      .order("jurisdiction", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("effective_from", { ascending: true, nullsFirst: true }),
    supabase
      .from("air_quality_settings")
      .select("default_jurisdiction")
      .eq("facility_id", facilityId)
      .maybeSingle(),
  ])
  const rules = (rulesRes.data ?? []) as ComplianceRuleRow[]
  const jurisdictions = Array.from(
    new Set(rules.map((r) => r.jurisdiction)),
  ).sort()

  const data: ComplianceData = {
    rules,
    jurisdictions,
    defaultJurisdiction:
      (settingsRes.data?.default_jurisdiction as string | null) ?? null,
  }
  return (
    <ComplianceTab
      data={data}
      activeJurisdiction={params.jurisdiction ?? null}
    />
  )
}

// ---------------------------------------------------------------------------
// History tab loader
// ---------------------------------------------------------------------------

async function HistoryTabLoader({
  facilityId,
  params,
}: {
  facilityId: string
  params: {
    report?: string
    employee?: string
    equipment?: string
    reading_type?: string
    exceedance?: string
    from?: string
    to?: string
    q?: string
    location?: string
  }
}) {
  const supabase = await createClient()

  const from = params.from ?? defaultDateFrom()
  const to = params.to ?? null

  const [empsRes, locsRes, equipRes, rtRes] = await Promise.all([
    supabase
      .from("employees")
      .select("id, first_name, last_name")
      .eq("facility_id", facilityId)
      .order("last_name", { ascending: true }),
    supabase
      .from("air_quality_locations")
      .select("*")
      .eq("facility_id", facilityId)
      .order("name", { ascending: true }),
    supabase
      .from("air_quality_equipment")
      .select("*")
      .eq("facility_id", facilityId)
      .order("name", { ascending: true }),
    supabase
      .from("air_quality_reading_types")
      .select("*")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true }),
  ])
  const employees = (empsRes.data ?? []) as EmployeeLite[]
  const locations = (locsRes.data ?? []) as LocationRow[]
  const equipmentList = (equipRes.data ?? []) as EquipmentRow[]
  const readingTypes = (rtRes.data ?? []) as ReadingTypeRow[]

  let q = supabase
    .from("air_quality_reports")
    .select("*")
    .eq("facility_id", facilityId)
    .order("submitted_at", { ascending: false })
    .limit(200)
  if (params.employee) q = q.eq("employee_id", params.employee)
  if (params.location) q = q.eq("location_id", params.location)
  if (params.equipment) q = q.eq("equipment_id", params.equipment)
  if (params.exceedance === "yes") q = q.eq("has_exceedance", true)
  if (params.exceedance === "no") q = q.eq("has_exceedance", false)
  if (from) q = q.gte("submitted_at", `${from}T00:00:00.000Z`)
  if (to) q = q.lte("submitted_at", `${to}T23:59:59.999Z`)
  if (params.q) q = q.ilike("notes", `%${params.q}%`)

  const { data: reportsRaw } = await q
  let reports = (reportsRaw ?? []) as ReportRow[]

  // Reading-type filter requires checking child readings.
  if (params.reading_type && reports.length > 0) {
    const rtId = params.reading_type
    const ids = reports.map((r) => r.id)
    const { data } = await supabase
      .from("air_quality_readings")
      .select("report_id")
      .in("report_id", ids)
      .eq("reading_type_id", rtId)
    const matched = new Set(
      (data ?? []).map((r: { report_id: string }) => r.report_id),
    )
    reports = reports.filter((r) => matched.has(r.id))
  }

  // Aggregate readings per report.
  let readingAgg: Array<{ report_id: string; is_exceedance: boolean }> = []
  if (reports.length > 0) {
    const ids = reports.map((r) => r.id)
    const { data } = await supabase
      .from("air_quality_readings")
      .select("report_id, is_exceedance")
      .in("report_id", ids)
    readingAgg = (data ?? []) as Array<{
      report_id: string
      is_exceedance: boolean
    }>
  }
  const totalsByReport = new Map<
    string,
    { total: number; exceedance: number }
  >()
  for (const v of readingAgg) {
    const cur = totalsByReport.get(v.report_id) ?? { total: 0, exceedance: 0 }
    cur.total += 1
    if (v.is_exceedance) cur.exceedance += 1
    totalsByReport.set(v.report_id, cur)
  }

  // Resolve listed report employees from preloaded list.
  const empById = new Map(employees.map((e) => [e.id, e]))
  const locById = new Map(locations.map((l) => [l.id, l]))
  const equipById = new Map(equipmentList.map((e) => [e.id, e]))

  const list: ReportListItem[] = reports.map((r) => {
    const totals = totalsByReport.get(r.id) ?? { total: 0, exceedance: 0 }
    return {
      ...r,
      location: locById.get(r.location_id) ?? null,
      equipment: r.equipment_id ? (equipById.get(r.equipment_id) ?? null) : null,
      employee: r.employee_id ? (empById.get(r.employee_id) ?? null) : null,
      reading_count: totals.total,
      exceedance_count: totals.exceedance,
      notes_excerpt:
        r.notes && r.notes.trim().length > 0
          ? r.notes.length > 120
            ? `${r.notes.slice(0, 117).trim()}…`
            : r.notes
          : null,
    }
  })

  // Drilldown
  let detail: ReportDetailData | null = null
  if (params.report) {
    let baseReport = reports.find((r) => r.id === params.report) ?? null
    if (!baseReport) {
      const { data } = await supabase
        .from("air_quality_reports")
        .select("*")
        .eq("facility_id", facilityId)
        .eq("id", params.report)
        .maybeSingle()
      baseReport = (data ?? null) as ReportRow | null
    }
    if (baseReport) {
      const [readingsRes, notesRes] = await Promise.all([
        supabase
          .from("air_quality_readings")
          .select("*")
          .eq("report_id", baseReport.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("air_quality_followup_notes")
          .select("*")
          .eq("report_id", baseReport.id)
          .order("created_at", { ascending: true }),
      ])
      const readings = (readingsRes.data ?? []) as ReadingRow[]
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
        location: locById.get(baseReport.location_id) ?? null,
        equipment: baseReport.equipment_id
          ? (equipById.get(baseReport.equipment_id) ?? null)
          : null,
        employee: baseReport.employee_id
          ? (empById.get(baseReport.employee_id) ?? null)
          : null,
        readings,
        notes: noteRows.map((n) => ({
          ...n,
          author: n.employee_id ? (authorById.get(n.employee_id) ?? null) : null,
        })),
      }
    }
  }

  const backSp = new URLSearchParams()
  backSp.set("tab", "history")
  for (const k of [
    "employee",
    "location",
    "equipment",
    "reading_type",
    "exceedance",
    "from",
    "to",
    "q",
  ] as const) {
    const v = params[k]
    if (v) backSp.set(k, v)
  }
  const backHref = `/admin/air-quality?${backSp.toString()}`

  return (
    <HistoryTab
      list={list}
      detail={detail}
      backHref={backHref}
      employees={employees}
      locations={locations}
      equipment={equipmentList}
      readingTypes={readingTypes}
      params={{ ...params, from }}
    />
  )
}

// ---------------------------------------------------------------------------
// Settings tab loader
// ---------------------------------------------------------------------------

async function SettingsTabLoader({ facilityId }: { facilityId: string }) {
  const supabase = await createClient()
  const [settingsRes, rulesRes] = await Promise.all([
    supabase
      .from("air_quality_settings")
      .select("*")
      .eq("facility_id", facilityId)
      .maybeSingle(),
    supabase
      .from("air_quality_compliance_rules")
      .select("jurisdiction")
      .eq("facility_id", facilityId),
  ])
  const settings = (settingsRes.data ?? null) as SettingsRow | null
  const jurisdictions = Array.from(
    new Set(
      ((rulesRes.data ?? []) as Array<{ jurisdiction: string }>).map(
        (r) => r.jurisdiction,
      ),
    ),
  ).sort()
  return <SettingsTab settings={settings} jurisdictions={jurisdictions} />
}
