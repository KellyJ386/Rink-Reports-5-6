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
import { getRinkLogoSignedUrl, getRinkOverlays } from "@/lib/ice-depth/overlays"
import { clampShow, nextShow } from "@/lib/pagination"

import { AnalyticsTab } from "./_components/analytics-tab"
import { HistoryTab } from "./_components/history-tab"
import {
  rollupByPoint,
  summarizeAnalytics,
  trendByDay,
  type AnalyticsMeasurement,
  type AnalyticsSession,
} from "./_lib/analytics"
import { LayoutsTab } from "./_components/layouts-tab"
import { OverlaysTab } from "./_components/overlays-tab"
import { RinksTab } from "./_components/rinks-tab"
import { SeedDefaultsCard } from "./_components/seed-defaults-card"
import { SettingsTab } from "./_components/settings-tab"
import type {
  DoorMarkerRow,
  DoorTypeRow,
  EmployeeLite,
  FollowupNoteRow,
  HistoryParams,
  LayoutDetail,
  LayoutRow,
  LayoutWithPointCount,
  MeasurementRow,
  PointRow,
  RinkDiagramConfigRow,
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
  show?: string
}>

// History "Load more" page sizing.
const HISTORY_SHOW = { initial: 50, step: 50, max: 2000 } as const

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
  // The ice-depth RLS write policies gate on the module-scoped admin grant,
  // which requireAdmin does not imply. Without this, a global admin lacking
  // the grant gets a console whose every write dies at the RLS layer.
  await requireModuleAdmin("ice_depth")
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
      {tab === "overlays" && <OverlaysTabLoader facilityId={facilityId} />}
      {tab === "history" && (
        <HistoryTabLoader
          facilityId={facilityId}
          params={params}
          canDelete={profile?.is_super_admin === true}
        />
      )}
      {tab === "analytics" && (
        <AnalyticsTabLoader facilityId={facilityId} params={params} />
      )}
      {tab === "settings" && <SettingsTabLoader facilityId={facilityId} />}
    </div>
  )
}

function Header() {
  return (
    <PageHeader
      title="Ice Depth"
      description="Manage rinks (sheets of ice), build their diagrams and measurement points, review submitted depth sessions, and configure thresholds, colors, and alerting. Sessions are immutable."
      actions={<ExportButton moduleKey="ice_depth" />}
    />
  )
}

function TabBar({ active }: { active: Tab }) {
  return (
    <TabNav
      ariaLabel="Ice depth sections"
      activeHref={tabHref(active)}
      items={TABS.map((t) => ({ label: t.label, href: tabHref(t.key) }))}
    />
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
// Overlays tab (facility-level door markers + center-ice logo watermark)
// ---------------------------------------------------------------------------

async function OverlaysTabLoader({ facilityId }: { facilityId: string }) {
  const supabase = await createClient()
  const [typesRes, markersRes, configRes] = await Promise.all([
    supabase
      .from("facility_door_types")
      .select("*")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("facility_door_markers")
      .select("*")
      .eq("facility_id", facilityId)
      .order("created_at", { ascending: true }),
    supabase
      .from("facility_rink_diagram_config")
      .select("*")
      .eq("facility_id", facilityId)
      .maybeSingle(),
  ])
  const config = (configRes.data ?? null) as RinkDiagramConfigRow | null
  // Signed even while hidden so the editor can preview before re-enabling.
  const logoUrl = await getRinkLogoSignedUrl(
    supabase,
    config?.logo_storage_path ?? null,
  )
  return (
    <OverlaysTab
      doorTypes={(typesRes.data ?? []) as DoorTypeRow[]}
      markers={(markersRes.data ?? []) as DoorMarkerRow[]}
      config={config}
      logoUrl={logoUrl}
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
  canDelete,
}: {
  facilityId: string
  params: HistoryParams & { session?: string; show?: string }
  canDelete: boolean
}) {
  const supabase = await createClient()

  const from = params.from ?? defaultDateFrom()
  const to = params.to ?? null
  const show = clampShow(params.show, HISTORY_SHOW)

  // Facility timezone rides along so timestamps render as facility
  // wall-clock (the server runs in UTC; the viewer's browser may be anywhere).
  const [layoutsRes, empsRes, facilityRes] = await Promise.all([
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
    supabase
      .from("facilities")
      .select("timezone")
      .eq("id", facilityId)
      .maybeSingle(),
  ])
  const layouts = (layoutsRes.data ?? []) as LayoutRow[]
  const employees = (empsRes.data ?? []) as EmployeeLite[]
  const timezone = facilityRes.data?.timezone ?? null

  // Fetch one extra row (range is inclusive: 0..show => show+1 rows) so we can
  // tell whether a "Load more" link is warranted without a separate count.
  let q = supabase
    .from("ice_depth_sessions")
    .select("*")
    .eq("facility_id", facilityId)
    .order("submitted_at", { ascending: false })
    .range(0, show)
  if (params.layout) q = q.eq("layout_id", params.layout)
  if (params.employee) q = q.eq("employee_id", params.employee)
  if (params.has_low === "yes") q = q.eq("has_low_reading", true)
  if (params.has_low === "no") q = q.eq("has_low_reading", false)
  if (params.has_high === "yes") q = q.eq("has_high_reading", true)
  if (params.has_high === "no") q = q.eq("has_high_reading", false)
  if (from) q = q.gte("submitted_at", `${from}T00:00:00.000Z`)
  if (to) q = q.lte("submitted_at", `${to}T23:59:59.999Z`)

  const { data: rawSessions } = await q
  const fetched = (rawSessions ?? []) as SessionRow[]
  const hasMore = fetched.length > show
  const sessions = hasMore ? fetched.slice(0, show) : fetched

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
      const [pointsRes, measRes, notesRes, reporterRes, settingsRes, overlays] =
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
          getRinkOverlays(supabase, facilityId),
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
        overlays,
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

  // "Load more": same filters, larger `show`. nextShow returns null at the cap.
  const nextSize = nextShow(show, HISTORY_SHOW)
  let moreHref: string | null = null
  if (hasMore && nextSize !== null) {
    const moreSp = new URLSearchParams(backSp)
    moreSp.set("show", String(nextSize))
    moreHref = `/admin/ice-depth?${moreSp.toString()}`
  }

  return (
    <HistoryTab
      list={list}
      detail={detail}
      backHref={backHref}
      layouts={layouts}
      employees={employees}
      params={{ ...params, from }}
      moreHref={moreHref}
      canDelete={canDelete}
      timezone={timezone}
    />
  )
}

// ---------------------------------------------------------------------------
// Analytics tab
// ---------------------------------------------------------------------------

async function AnalyticsTabLoader({
  facilityId,
  params,
}: {
  facilityId: string
  params: { layout?: string; from?: string; to?: string }
}) {
  const supabase = await createClient()

  const from = params.from ?? defaultDateFrom()
  const to = params.to ?? null

  const [layoutsRes, settingsRes] = await Promise.all([
    supabase
      .from("ice_depth_layouts")
      .select("id, name, slug, is_default, is_active")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("ice_depth_settings")
      .select("low_color, ok_color, high_color, measurement_unit")
      .eq("facility_id", facilityId)
      .maybeSingle(),
  ])
  const layouts = (layoutsRes.data ?? []) as Array<{
    id: string
    name: string
    slug: string
    is_default: boolean | null
    is_active: boolean
  }>

  // Pick the requested layout, else the default, else the first. Analytics are
  // per-layout because each layout has its own point grid.
  const selected =
    layouts.find((l) => l.id === params.layout) ??
    layouts.find((l) => l.is_default) ??
    layouts[0] ??
    null

  let summary = summarizeAnalytics([], 0)
  let points: ReturnType<typeof rollupByPoint> = []
  let trend: ReturnType<typeof trendByDay> = []

  if (selected) {
    let sq = supabase
      .from("ice_depth_sessions")
      .select("id, submitted_at, low_count, high_count, total_measurements")
      .eq("facility_id", facilityId)
      .eq("layout_id", selected.id)
      .order("submitted_at", { ascending: false })
      .limit(2000)
    if (from) sq = sq.gte("submitted_at", `${from}T00:00:00.000Z`)
    if (to) sq = sq.lte("submitted_at", `${to}T23:59:59.999Z`)
    const { data: sessRows } = await sq
    const sessions = (sessRows ?? []) as Array<
      AnalyticsSession & { id: string }
    >

    let measurements: AnalyticsMeasurement[] = []
    if (sessions.length > 0) {
      const { data: measRows } = await supabase
        .from("ice_depth_measurements")
        .select(
          "point_number_snapshot, label_snapshot, x_snapshot, y_snapshot, depth_value, severity",
        )
        .eq("facility_id", facilityId)
        .in(
          "session_id",
          sessions.map((s) => s.id),
        )
      measurements = (measRows ?? []) as AnalyticsMeasurement[]
    }

    summary = summarizeAnalytics(measurements, sessions.length)
    points = rollupByPoint(measurements)
    trend = trendByDay(sessions)
  }

  return (
    <AnalyticsTab
      layouts={layouts.map((l) => ({ id: l.id, name: l.name }))}
      selectedLayoutId={selected?.id ?? null}
      summary={summary}
      points={points}
      trend={trend}
      colors={{
        low: settingsRes.data?.low_color ?? "#ef4444",
        ok: settingsRes.data?.ok_color ?? "#22c55e",
        high: settingsRes.data?.high_color ?? "#eab308",
      }}
      unit={settingsRes.data?.measurement_unit ?? "inches"}
      from={from}
      to={to}
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
