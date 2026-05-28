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
import { SettingsTab } from "./_components/settings-tab"
import { SetupTab } from "./_components/setup-tab"
import type {
  EmployeeLite,
  EquipmentRow,
  FieldRow,
  FollowupNoteRow,
  ReportDetailData,
  ReportListItem,
  ReportRow,
  ReportValueRow,
  SectionDetail,
  SectionRow,
  SectionWithCounts,
  SettingsRow,
  Tab,
  ThresholdRow,
} from "./types"
import { TABS, asTab } from "./types"

export const dynamic = "force-dynamic"

type SearchParams = Promise<{
  tab?: string
  section?: string
  equipment?: string
  field?: string
  report?: string
  employee?: string
  from?: string
  to?: string
  oor?: string
  q?: string
}>

function tabHref(tab: Tab): string {
  const sp = new URLSearchParams()
  sp.set("tab", tab)
  return `/admin/refrigeration?${sp.toString()}`
}

function defaultDateFrom(): string {
  const d = new Date()
  d.setDate(d.getDate() - 14)
  return d.toISOString().slice(0, 10)
}

export const metadata = { title: "Refrigeration | MFO / Rink Reports" }

export default async function RefrigerationAdminPage({
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
              Create a facility before configuring refrigeration reports.
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
      {tab === "history" && (
        <HistoryTabLoader facilityId={facilityId} params={params} />
      )}
      {tab === "settings" && <SettingsTabLoader facilityId={facilityId} />}
    </div>
  )
}

function Header() {
  return (
    <PageHeader
      title="Refrigeration"
      description="Configure sections, equipment, fields, and thresholds. Review submitted reports and add follow-up notes. Original reports are immutable."
      actions={<ExportButton moduleKey="refrigeration" />}
    />
  )
}

function TabBar({ active }: { active: Tab }) {
  return (
    <TabNav
      ariaLabel="Refrigeration sections"
      activeHref={tabHref(active)}
      items={TABS.map((t) => ({ label: t.label, href: tabHref(t.key) }))}
    />
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
  params: { section?: string }
}) {
  const supabase = await createClient()
  const [sectionsRes, equipCountsRes, fieldCountsRes] = await Promise.all([
    supabase
      .from("refrigeration_sections")
      .select("*")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("refrigeration_equipment")
      .select("section_id")
      .eq("facility_id", facilityId),
    supabase
      .from("refrigeration_fields")
      .select("section_id")
      .eq("facility_id", facilityId),
  ])
  const sections = (sectionsRes.data ?? []) as SectionRow[]

  const equipBySection = new Map<string, number>()
  for (const row of (equipCountsRes.data ?? []) as Array<{
    section_id: string
  }>) {
    equipBySection.set(
      row.section_id,
      (equipBySection.get(row.section_id) ?? 0) + 1,
    )
  }
  const fieldsBySection = new Map<string, number>()
  for (const row of (fieldCountsRes.data ?? []) as Array<{
    section_id: string
  }>) {
    fieldsBySection.set(
      row.section_id,
      (fieldsBySection.get(row.section_id) ?? 0) + 1,
    )
  }

  const sectionsWithCounts: SectionWithCounts[] = sections.map((s) => ({
    ...s,
    equipment_count: equipBySection.get(s.id) ?? 0,
    field_count: fieldsBySection.get(s.id) ?? 0,
  }))

  let detail: SectionDetail | null = null
  if (params.section) {
    const section = sections.find((s) => s.id === params.section) ?? null
    if (section) {
      const [equipRes, fieldsRes, threshRes] = await Promise.all([
        supabase
          .from("refrigeration_equipment")
          .select("*")
          .eq("facility_id", facilityId)
          .eq("section_id", section.id)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true }),
        supabase
          .from("refrigeration_fields")
          .select("*")
          .eq("facility_id", facilityId)
          .eq("section_id", section.id)
          .order("sort_order", { ascending: true })
          .order("label", { ascending: true }),
        supabase
          .from("refrigeration_thresholds")
          .select("*")
          .eq("facility_id", facilityId),
      ])
      const equipment = (equipRes.data ?? []) as EquipmentRow[]
      const fields = (fieldsRes.data ?? []) as FieldRow[]
      const thresholds = (threshRes.data ?? []) as ThresholdRow[]
      const fieldIds = new Set(fields.map((f) => f.id))
      detail = {
        section,
        equipment,
        fields,
        thresholds: thresholds.filter((t) => fieldIds.has(t.field_id)),
      }
    }
  }

  return (
    <SetupTab
      sections={sectionsWithCounts}
      detail={detail}
      activeSectionId={params.section ?? null}
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
    from?: string
    to?: string
    oor?: string
    q?: string
  }
}) {
  const supabase = await createClient()

  const from = params.from ?? defaultDateFrom()
  const to = params.to ?? null

  const empsRes = await supabase
    .from("employees")
    .select("id, first_name, last_name")
    .eq("facility_id", facilityId)
    .order("last_name", { ascending: true })
  const employees = (empsRes.data ?? []) as EmployeeLite[]

  let q = supabase
    .from("refrigeration_reports")
    .select("*")
    .eq("facility_id", facilityId)
    .order("submitted_at", { ascending: false })
    .limit(200)
  if (params.employee) q = q.eq("employee_id", params.employee)
  if (from) q = q.gte("submitted_at", `${from}T00:00:00.000Z`)
  if (to) q = q.lte("submitted_at", `${to}T23:59:59.999Z`)
  if (params.q) q = q.ilike("notes", `%${params.q}%`)

  const { data: reportsRaw } = await q
  const reports = (reportsRaw ?? []) as ReportRow[]

  // Aggregate value counts + OOR counts per report.
  let valueAgg: Array<{ report_id: string; is_out_of_range: boolean }> = []
  if (reports.length > 0) {
    const ids = reports.map((r) => r.id)
    const { data } = await supabase
      .from("refrigeration_report_values")
      .select("report_id, is_out_of_range")
      .in("report_id", ids)
    valueAgg = (data ?? []) as Array<{
      report_id: string
      is_out_of_range: boolean
    }>
  }
  const totalsByReport = new Map<string, { total: number; oor: number }>()
  for (const v of valueAgg) {
    const cur = totalsByReport.get(v.report_id) ?? { total: 0, oor: 0 }
    cur.total += 1
    if (v.is_out_of_range) cur.oor += 1
    totalsByReport.set(v.report_id, cur)
  }

  // Resolve listed report employees.
  const empIds = Array.from(
    new Set(reports.map((r) => r.employee_id).filter((x): x is string => !!x)),
  )
  let listedEmps: EmployeeLite[] = []
  if (empIds.length > 0) {
    const { data } = await supabase
      .from("employees")
      .select("id, first_name, last_name")
      .in("id", empIds)
    listedEmps = (data ?? []) as EmployeeLite[]
  }
  const empById = new Map(listedEmps.map((e) => [e.id, e]))

  let list: ReportListItem[] = reports.map((r) => {
    const totals = totalsByReport.get(r.id) ?? { total: 0, oor: 0 }
    return {
      ...r,
      employee: r.employee_id ? (empById.get(r.employee_id) ?? null) : null,
      value_count: totals.total,
      out_of_range_count: totals.oor,
      notes_excerpt:
        r.notes && r.notes.trim().length > 0
          ? r.notes.length > 120
            ? `${r.notes.slice(0, 117).trim()}…`
            : r.notes
          : null,
    }
  })

  if (params.oor === "yes") list = list.filter((r) => r.out_of_range_count > 0)
  if (params.oor === "no") list = list.filter((r) => r.out_of_range_count === 0)

  // Drilldown
  let detail: ReportDetailData | null = null
  if (params.report) {
    let baseReport = reports.find((r) => r.id === params.report) ?? null
    if (!baseReport) {
      const { data } = await supabase
        .from("refrigeration_reports")
        .select("*")
        .eq("facility_id", facilityId)
        .eq("id", params.report)
        .maybeSingle()
      baseReport = (data ?? null) as ReportRow | null
    }
    if (baseReport) {
      const [valuesRes, notesRes, reporterRes] = await Promise.all([
        supabase
          .from("refrigeration_report_values")
          .select("*")
          .eq("report_id", baseReport.id),
        supabase
          .from("refrigeration_followup_notes")
          .select("*")
          .eq("report_id", baseReport.id)
          .order("created_at", { ascending: true }),
        baseReport.employee_id
          ? supabase
              .from("employees")
              .select("id, first_name, last_name")
              .eq("id", baseReport.employee_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      const values = (valuesRes.data ?? []) as ReportValueRow[]
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
        employee: (reporterRes.data ?? null) as EmployeeLite | null,
        values,
        notes: noteRows.map((n) => ({
          ...n,
          author: n.employee_id ? (authorById.get(n.employee_id) ?? null) : null,
        })),
      }
    }
  }

  const backSp = new URLSearchParams()
  backSp.set("tab", "history")
  for (const k of ["employee", "from", "to", "oor", "q"] as const) {
    const v = params[k]
    if (v) backSp.set(k, v)
  }
  const backHref = `/admin/refrigeration?${backSp.toString()}`

  return (
    <HistoryTab
      list={list}
      detail={detail}
      backHref={backHref}
      employees={employees}
      params={{ ...params, from }}
    />
  )
}

// ---------------------------------------------------------------------------
// Settings tab loader
// ---------------------------------------------------------------------------

async function SettingsTabLoader({ facilityId }: { facilityId: string }) {
  const supabase = await createClient()
  const { data } = await supabase
    .from("refrigeration_settings")
    .select("*")
    .eq("facility_id", facilityId)
    .maybeSingle()
  const settings = (data ?? null) as SettingsRow | null
  return <SettingsTab settings={settings} />
}
