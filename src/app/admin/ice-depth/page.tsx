import Link from "next/link"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ExportButton } from "@/components/admin/export-button"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

import { HistoryTab } from "./_components/history-tab"
import { LayoutsTab } from "./_components/layouts-tab"
import { RinksTab } from "./_components/rinks-tab"
import { SeedDefaultsCard } from "./_components/seed-defaults-card"
import { SettingsTab } from "./_components/settings-tab"
import type {
  EmployeeLite,
  FollowupNoteRow,
  HistoryParams,
  LayoutDetail,
  LayoutRow,
  LayoutWithPointCount,
  MeasurementRow,
  PointRow,
  RinkOption,
  RinkRow,
  RinkWithLayoutCount,
  SessionDetailData,
  SessionListItem,
  SessionRow,
  SettingsRow,
  Tab,
} from "./types"
import { TABS, asTab } from "./types"

export const dynamic = "force-dynamic"

type SearchParams = Promise<{
  tab?: string
  layout?: string
  session?: string
  employee?: string
  has_low?: string
  has_high?: string
  from?: string
  to?: string
}>

function tabHref(tab: Tab): string {
  const sp = new URLSearchParams()
  sp.set("tab", tab)
  return `/admin/ice-depth?${sp.toString()}`
}

function defaultDateFrom(): string {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}

export const metadata = { title: "Ice Depth | MFO / Rink Reports" }

export default async function IceDepthAdminPage({
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
              Create a facility before configuring ice depth reports.
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

      {tab === "rinks" && <RinksTabLoader facilityId={facilityId} />}
      {tab === "layouts" && (
        <LayoutsTabLoader facilityId={facilityId} params={params} />
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
        <h1 className="text-2xl font-semibold tracking-tight">Ice Depth</h1>
        <p className="text-muted-foreground text-sm">
          Manage rinks (sheets of ice), build their diagrams and measurement
          points, review submitted depth sessions, and configure thresholds,
          colors, and alerting. Sessions are immutable.
        </p>
      </div>
      <ExportButton moduleKey="ice_depth" />
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
// Layouts tab
// ---------------------------------------------------------------------------

async function LayoutsTabLoader({
  facilityId,
  params,
}: {
  facilityId: string
  params: { layout?: string }
}) {
  const supabase = await createClient()
  const [layoutsRes, pointCountsRes, settingsRes, rinksRes] = await Promise.all([
    supabase
      .from("ice_depth_layouts")
      .select("*")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("ice_depth_points")
      .select("layout_id, is_active")
      .eq("facility_id", facilityId),
    supabase
      .from("ice_depth_settings")
      .select("id")
      .eq("facility_id", facilityId)
      .maybeSingle(),
    supabase
      .from("ice_depth_rinks")
      .select("id, name, is_active")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
  ])

  const rinks = (rinksRes.data ?? []) as RinkOption[]
  const rawLayouts = (layoutsRes.data ?? []) as LayoutRow[]
  const counts = new Map<string, { active: number; total: number }>()
  for (const row of (pointCountsRes.data ?? []) as Array<{
    layout_id: string
    is_active: boolean
  }>) {
    const cur = counts.get(row.layout_id) ?? { active: 0, total: 0 }
    cur.total += 1
    if (row.is_active) cur.active += 1
    counts.set(row.layout_id, cur)
  }
  const layouts: LayoutWithPointCount[] = rawLayouts.map((l) => ({
    ...l,
    active_point_count: counts.get(l.id)?.active ?? 0,
    total_point_count: counts.get(l.id)?.total ?? 0,
  }))

  // Settings row presence drives the "Seed defaults" card.
  if (!settingsRes.data && layouts.length === 0 && rinks.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <SeedDefaultsCard />
      </div>
    )
  }

  let activeLayout: LayoutDetail | null = null
  if (params.layout) {
    const layout = rawLayouts.find((l) => l.id === params.layout) ?? null
    if (layout) {
      const { data } = await supabase
        .from("ice_depth_points")
        .select("*")
        .eq("facility_id", facilityId)
        .eq("layout_id", layout.id)
        .order("point_number", { ascending: true })
      activeLayout = {
        layout,
        points: (data ?? []) as PointRow[],
      }
    }
  }

  const backHref = "/admin/ice-depth?tab=layouts"

  return (
    <LayoutsTab
      layouts={layouts}
      rinks={rinks}
      activeLayout={activeLayout}
      activeLayoutId={params.layout ?? null}
      backHref={backHref}
    />
  )
}

// ---------------------------------------------------------------------------
// Rinks tab
// ---------------------------------------------------------------------------

async function RinksTabLoader({ facilityId }: { facilityId: string }) {
  const supabase = await createClient()
  const [rinksRes, layoutsRes] = await Promise.all([
    supabase
      .from("ice_depth_rinks")
      .select("*")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("ice_depth_layouts")
      .select("rink_id, is_active")
      .eq("facility_id", facilityId),
  ])

  const rawRinks = (rinksRes.data ?? []) as RinkRow[]
  const counts = new Map<string, { active: number; total: number }>()
  for (const row of (layoutsRes.data ?? []) as Array<{
    rink_id: string | null
    is_active: boolean
  }>) {
    if (!row.rink_id) continue
    const cur = counts.get(row.rink_id) ?? { active: 0, total: 0 }
    cur.total += 1
    if (row.is_active) cur.active += 1
    counts.set(row.rink_id, cur)
  }
  const rinks: RinkWithLayoutCount[] = rawRinks.map((r) => ({
    ...r,
    layout_count: counts.get(r.id)?.total ?? 0,
    active_layout_count: counts.get(r.id)?.active ?? 0,
  }))

  return <RinksTab rinks={rinks} />
}

// ---------------------------------------------------------------------------
// History tab
// ---------------------------------------------------------------------------

async function HistoryTabLoader({
  facilityId,
  params,
}: {
  facilityId: string
  params: HistoryParams & { session?: string }
}) {
  const supabase = await createClient()

  const from = params.from ?? defaultDateFrom()
  const to = params.to ?? null

  const [layoutsRes, empsRes] = await Promise.all([
    supabase
      .from("ice_depth_layouts")
      .select("*")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("employees")
      .select("id, first_name, last_name")
      .eq("facility_id", facilityId)
      .order("last_name", { ascending: true }),
  ])
  const layouts = (layoutsRes.data ?? []) as LayoutRow[]
  const employees = (empsRes.data ?? []) as EmployeeLite[]

  let q = supabase
    .from("ice_depth_sessions")
    .select("*")
    .eq("facility_id", facilityId)
    .order("submitted_at", { ascending: false })
    .limit(200)
  if (params.layout) q = q.eq("layout_id", params.layout)
  if (params.employee) q = q.eq("employee_id", params.employee)
  if (params.has_low === "yes") q = q.eq("has_low_reading", true)
  if (params.has_low === "no") q = q.eq("has_low_reading", false)
  if (params.has_high === "yes") q = q.eq("has_high_reading", true)
  if (params.has_high === "no") q = q.eq("has_high_reading", false)
  if (from) q = q.gte("submitted_at", `${from}T00:00:00.000Z`)
  if (to) q = q.lte("submitted_at", `${to}T23:59:59.999Z`)

  const { data: rawSessions } = await q
  const sessions = (rawSessions ?? []) as SessionRow[]

  const layoutById = new Map(layouts.map((l) => [l.id, l]))
  const empIds = Array.from(
    new Set(
      sessions.map((s) => s.employee_id).filter((x): x is string => !!x),
    ),
  )
  let listEmps: EmployeeLite[] = []
  if (empIds.length > 0) {
    const { data } = await supabase
      .from("employees")
      .select("id, first_name, last_name")
      .in("id", empIds)
    listEmps = (data ?? []) as EmployeeLite[]
  }
  const empById = new Map(listEmps.map((e) => [e.id, e]))

  const list: SessionListItem[] = sessions.map((s) => ({
    ...s,
    layout: layoutById.get(s.layout_id) ?? null,
    employee: s.employee_id ? (empById.get(s.employee_id) ?? null) : null,
  }))

  // Drilldown
  let detail: SessionDetailData | null = null
  if (params.session) {
    let session = sessions.find((s) => s.id === params.session) ?? null
    if (!session) {
      const { data } = await supabase
        .from("ice_depth_sessions")
        .select("*")
        .eq("facility_id", facilityId)
        .eq("id", params.session)
        .maybeSingle()
      session = (data ?? null) as SessionRow | null
    }
    if (session) {
      const sessionLayout = layoutById.get(session.layout_id) ?? null
      const [pointsRes, measRes, notesRes, reporterRes, settingsRes] =
        await Promise.all([
          sessionLayout
            ? supabase
                .from("ice_depth_points")
                .select("*")
                .eq("layout_id", sessionLayout.id)
                .order("point_number", { ascending: true })
            : Promise.resolve({ data: [] }),
          supabase
            .from("ice_depth_measurements")
            .select("*")
            .eq("session_id", session.id),
          supabase
            .from("ice_depth_followup_notes")
            .select("*")
            .eq("session_id", session.id)
            .order("created_at", { ascending: true }),
          session.employee_id
            ? supabase
                .from("employees")
                .select("id, first_name, last_name")
                .eq("id", session.employee_id)
                .maybeSingle()
            : Promise.resolve({ data: null }),
          supabase
            .from("ice_depth_settings")
            .select("*")
            .eq("facility_id", facilityId)
            .maybeSingle(),
        ])
      const points = (pointsRes.data ?? []) as PointRow[]
      const measurements = (measRes.data ?? []) as MeasurementRow[]
      const noteRows = (notesRes.data ?? []) as FollowupNoteRow[]
      const reporter = (reporterRes.data ?? null) as EmployeeLite | null

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
        session,
        layout: sessionLayout,
        points,
        employee: reporter,
        measurements,
        notes: noteRows.map((n) => ({
          ...n,
          author: n.employee_id ? (authorById.get(n.employee_id) ?? null) : null,
        })),
        settings: (settingsRes.data ?? null) as SettingsRow | null,
      }
    }
  }

  const backSp = new URLSearchParams()
  backSp.set("tab", "history")
  for (const k of [
    "layout",
    "employee",
    "has_low",
    "has_high",
    "from",
    "to",
  ] as const) {
    const v = params[k]
    if (v) backSp.set(k, v)
  }
  const backHref = `/admin/ice-depth?${backSp.toString()}`

  return (
    <HistoryTab
      list={list}
      detail={detail}
      backHref={backHref}
      layouts={layouts}
      employees={employees}
      params={{ ...params, from }}
    />
  )
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

async function SettingsTabLoader({ facilityId }: { facilityId: string }) {
  const supabase = await createClient()
  const { data } = await supabase
    .from("ice_depth_settings")
    .select("*")
    .eq("facility_id", facilityId)
    .maybeSingle()
  const settings = (data ?? null) as SettingsRow | null
  if (!settings) {
    return (
      <div className="flex flex-col gap-4">
        <SeedDefaultsCard />
      </div>
    )
  }
  return <SettingsTab settings={settings} />
}
