import Link from "next/link"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

import { HistoryTab } from "./_components/history-tab"
import { SettingsTab } from "./_components/settings-tab"
import { SetupTab } from "./_components/setup-tab"
import type {
  CircleCheckItemRow,
  CircleCheckResultRow,
  CircleCheckTemplateItemRow,
  CircleCheckTemplateRow,
  EmployeeLite,
  EquipmentRow,
  FollowupNoteRow,
  FuelTypeRow,
  RinkRow,
  SettingsRow,
  SubmissionDetailData,
  SubmissionListItem,
  SubmissionRow,
  Tab,
} from "./types"
import {
  TABS,
  asTab,
  isOperationType,
  readBladeChangePayload,
} from "./types"

export const dynamic = "force-dynamic"

type SearchParams = Promise<{
  tab?: string
  submission?: string
  employee?: string
  rink?: string
  equipment?: string
  op?: string | string[]
  failed?: string
  from?: string
  to?: string
  q?: string
}>

function tabHref(tab: Tab): string {
  const sp = new URLSearchParams()
  sp.set("tab", tab)
  return `/admin/ice-operations?${sp.toString()}`
}

function defaultDateFrom(): string {
  const d = new Date()
  d.setDate(d.getDate() - 14)
  return d.toISOString().slice(0, 10)
}

function asArray(v: string | string[] | undefined): string[] {
  if (!v) return []
  return Array.isArray(v) ? v : [v]
}

export const metadata = { title: "Ice Operations | MFO / Rink Reports" }

export default async function IceOperationsAdminPage({
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
              Create a facility before configuring ice operations.
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

      {tab === "setup" && <SetupTabLoader facilityId={facilityId} />}
      {tab === "history" && (
        <HistoryTabLoader facilityId={facilityId} params={params} />
      )}
      {tab === "settings" && <SettingsTabLoader facilityId={facilityId} />}
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Ice Operations</h1>
      <p className="text-muted-foreground text-sm">
        Manage rinks, equipment, and circle-check items. Review submitted
        operations (ice make, circle check, edging, blade change) and append
        follow-up notes. Original reports are immutable.
      </p>
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

async function SetupTabLoader({ facilityId }: { facilityId: string }) {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const [rinksRes, equipRes, itemsRes, fuelsRes, tmplRes, tmplItemsRes] =
    await Promise.all([
      supabase
        .from("ice_operations_rinks")
        .select("*")
        .eq("facility_id", facilityId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("ice_operations_equipment")
        .select("*")
        .eq("facility_id", facilityId)
        .order("equipment_type", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("ice_operations_circle_check_items")
        .select("*")
        .eq("facility_id", facilityId)
        .order("sort_order", { ascending: true }),
      sb
        .from("ice_operations_fuel_types")
        .select("*")
        .eq("facility_id", facilityId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      sb
        .from("ice_operations_circle_check_templates")
        .select("*")
        .eq("facility_id", facilityId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      sb
        .from("ice_operations_circle_check_template_items")
        .select("*")
        .eq("facility_id", facilityId)
        .order("sort_order", { ascending: true }),
    ])

  const rinks = (rinksRes.data ?? []) as RinkRow[]
  const equipment = (equipRes.data ?? []) as EquipmentRow[]
  const circleCheckItems = (itemsRes.data ?? []) as CircleCheckItemRow[]
  const fuelTypes = (fuelsRes.data ?? []) as FuelTypeRow[]
  const templates = (tmplRes.data ?? []) as CircleCheckTemplateRow[]
  const templateItems = (tmplItemsRes.data ?? []) as CircleCheckTemplateItemRow[]

  return (
    <SetupTab
      rinks={rinks}
      equipment={equipment}
      circleCheckItems={circleCheckItems}
      fuelTypes={fuelTypes}
      templates={templates}
      templateItems={templateItems}
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
    submission?: string
    employee?: string
    rink?: string
    equipment?: string
    op?: string | string[]
    failed?: string
    from?: string
    to?: string
    q?: string
  }
}) {
  const supabase = await createClient()

  const from = params.from ?? defaultDateFrom()
  const to = params.to ?? null

  const [empsRes, rinksRes, equipRes, settingsRes] = await Promise.all([
    supabase
      .from("employees")
      .select("id, first_name, last_name")
      .eq("facility_id", facilityId)
      .order("last_name", { ascending: true }),
    supabase
      .from("ice_operations_rinks")
      .select("*")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("ice_operations_equipment")
      .select("*")
      .eq("facility_id", facilityId)
      .order("equipment_type", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("ice_operations_settings")
      .select("*")
      .eq("facility_id", facilityId)
      .maybeSingle(),
  ])

  const employees = (empsRes.data ?? []) as EmployeeLite[]
  const rinks = (rinksRes.data ?? []) as RinkRow[]
  const equipment = (equipRes.data ?? []) as EquipmentRow[]
  const settings = (settingsRes.data ?? null) as SettingsRow | null

  const opTypes = asArray(params.op).filter(isOperationType)

  let q = supabase
    .from("ice_operations_submissions")
    .select("*")
    .eq("facility_id", facilityId)
    .order("occurred_at", { ascending: false })
    .limit(200)
  if (params.employee) q = q.eq("employee_id", params.employee)
  if (params.rink) q = q.eq("rink_id", params.rink)
  if (params.equipment) q = q.eq("equipment_id", params.equipment)
  if (opTypes.length > 0) q = q.in("operation_type", opTypes)
  if (params.failed === "yes") q = q.eq("has_failed_check", true)
  if (params.failed === "no") q = q.eq("has_failed_check", false)
  if (from) q = q.gte("occurred_at", `${from}T00:00:00.000Z`)
  if (to) q = q.lte("occurred_at", `${to}T23:59:59.999Z`)
  if (params.q) q = q.ilike("notes", `%${params.q}%`)

  const { data: subsRaw } = await q
  const submissions = (subsRaw ?? []) as SubmissionRow[]

  const empIds = Array.from(
    new Set(
      submissions.map((s) => s.employee_id).filter((x): x is string => !!x),
    ),
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
  const rinkById = new Map(rinks.map((r) => [r.id, r]))
  const equipById = new Map(equipment.map((e) => [e.id, e]))

  const list: SubmissionListItem[] = submissions.map((s) => ({
    ...s,
    rink: s.rink_id ? (rinkById.get(s.rink_id) ?? null) : null,
    equipment: s.equipment_id ? (equipById.get(s.equipment_id) ?? null) : null,
    employee: s.employee_id ? (empById.get(s.employee_id) ?? null) : null,
  }))

  // Drilldown
  let detail: SubmissionDetailData | null = null
  if (params.submission) {
    let baseSub = submissions.find((s) => s.id === params.submission) ?? null
    if (!baseSub) {
      const { data } = await supabase
        .from("ice_operations_submissions")
        .select("*")
        .eq("facility_id", facilityId)
        .eq("id", params.submission)
        .maybeSingle()
      baseSub = (data ?? null) as SubmissionRow | null
    }
    if (baseSub) {
      const [resultsRes, notesRes, reporterRes] = await Promise.all([
        supabase
          .from("ice_operations_circle_check_results")
          .select("*")
          .eq("submission_id", baseSub.id),
        supabase
          .from("ice_operations_followup_notes")
          .select("*")
          .eq("submission_id", baseSub.id)
          .order("created_at", { ascending: true }),
        baseSub.employee_id
          ? supabase
              .from("employees")
              .select("id, first_name, last_name")
              .eq("id", baseSub.employee_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      const results = (resultsRes.data ?? []) as CircleCheckResultRow[]
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

      // Look up the "replaced_by" employee if the payload references one.
      let replacedByEmployee: EmployeeLite | null = null
      if (baseSub.operation_type === "blade_change") {
        const bc = readBladeChangePayload(baseSub.payload)
        if (bc.replaced_by_employee_id) {
          const { data: rb } = await supabase
            .from("employees")
            .select("id, first_name, last_name")
            .eq("id", bc.replaced_by_employee_id)
            .maybeSingle()
          replacedByEmployee = (rb ?? null) as EmployeeLite | null
        }
      }

      detail = {
        submission: baseSub,
        rink: baseSub.rink_id
          ? (rinkById.get(baseSub.rink_id) ?? null)
          : null,
        equipment: baseSub.equipment_id
          ? (equipById.get(baseSub.equipment_id) ?? null)
          : null,
        employee: (reporterRes.data ?? null) as EmployeeLite | null,
        results,
        notes: noteRows.map((n) => ({
          ...n,
          author: n.employee_id ? (authorById.get(n.employee_id) ?? null) : null,
        })),
        replacedByEmployee,
      }
    }
  }

  const backSp = new URLSearchParams()
  backSp.set("tab", "history")
  for (const k of [
    "employee",
    "rink",
    "equipment",
    "failed",
    "from",
    "to",
    "q",
  ] as const) {
    const v = params[k]
    if (typeof v === "string" && v) backSp.set(k, v)
  }
  for (const op of opTypes) backSp.append("op", op)
  const backHref = `/admin/ice-operations?${backSp.toString()}`

  return (
    <HistoryTab
      list={list}
      detail={detail}
      backHref={backHref}
      employees={employees}
      rinks={rinks}
      equipment={equipment}
      settings={settings}
      params={{
        employee: params.employee,
        rink: params.rink,
        equipment: params.equipment,
        op: opTypes,
        failed: params.failed,
        from,
        to: to ?? undefined,
        q: params.q,
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Settings tab loader
// ---------------------------------------------------------------------------

async function SettingsTabLoader({ facilityId }: { facilityId: string }) {
  const supabase = await createClient()
  const { data } = await supabase
    .from("ice_operations_settings")
    .select("*")
    .eq("facility_id", facilityId)
    .maybeSingle()
  const settings = (data ?? null) as SettingsRow | null
  return <SettingsTab settings={settings} />
}
