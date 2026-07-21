import "server-only"

import type { createClient } from "@/lib/supabase/server"
import type { Tables } from "@/types/database"
import { dayKeyInTz, weekdayOfKey } from "@/lib/timezone"

import {
  computeDueItemIds,
  worstOpenSeverity,
  type Cadence,
  type IssueSeverity,
} from "./compute"

type ServerSupabase = Awaited<ReturnType<typeof createClient>>

export type RinkRow = Tables<"dasher_boards_rinks">
export type AssetRow = Tables<"dasher_boards_assets">
export type IssueRow = Tables<"dasher_boards_issues">
export type InspectionRow = Tables<"dasher_boards_inspections">
export type ChecklistItemRow = Tables<"dasher_boards_checklist_items">
export type AssetEventRow = Tables<"dasher_boards_asset_events">

export type PerimeterAsset = AssetRow & {
  open_count: number
  worst_open_severity: IssueSeverity | null
}

export type RinkPerimeter = {
  rink: RinkRow
  assets: PerimeterAsset[]
}

/**
 * The one query that powers the diagram: the rink plus its full ordered asset
 * list, each asset annotated with its open-issue rollup (open_count +
 * worst_open_severity). Ordering: positioned assets (boards/doors) by
 * sequence_position; glass rows ride along via parent_board_id.
 */
export async function getRinkPerimeter(
  supabase: ServerSupabase,
  rinkId: string,
): Promise<RinkPerimeter | null> {
  const { data: rink } = await supabase
    .from("dasher_boards_rinks")
    .select("*")
    .eq("id", rinkId)
    .maybeSingle()
  if (!rink) return null

  const { data: assets } = await supabase
    .from("dasher_boards_assets")
    .select("*")
    .eq("rink_id", rinkId)
    .order("sequence_position", { ascending: true, nullsFirst: false })
    .order("label", { ascending: true })
  if (!assets) return { rink, assets: [] }

  const { data: openIssues } = await supabase
    .from("dasher_boards_issues")
    .select("asset_id, severity")
    .eq("rink_id", rinkId)
    .is("resolved_at", null)
    .not("asset_id", "is", null)

  // Glass rows have no segment of their own — an open issue on G12 must color
  // the B12 position on the diagram. Attribute glass issues to BOTH the glass
  // row (its own open_count in the dialog) and its parent board (the segment).
  const glassParent = new Map<string, string>()
  for (const a of assets) {
    if (a.asset_type === "glass_panel" && a.parent_board_id) {
      glassParent.set(a.id, a.parent_board_id)
    }
  }
  const rollup = new Map<string, IssueSeverity[]>()
  const push = (assetId: string, severity: IssueSeverity) => {
    const list = rollup.get(assetId) ?? []
    list.push(severity)
    rollup.set(assetId, list)
  }
  for (const row of openIssues ?? []) {
    if (!row.asset_id) continue
    push(row.asset_id, row.severity as IssueSeverity)
    const parentId = glassParent.get(row.asset_id)
    if (parentId) push(parentId, row.severity as IssueSeverity)
  }

  return {
    rink,
    assets: assets.map((a) => {
      const sevs = rollup.get(a.id) ?? []
      return {
        ...a,
        open_count: sevs.length,
        worst_open_severity: worstOpenSeverity(sevs),
      }
    }),
  }
}

export type AssetDetail = {
  asset: AssetRow
  subtypeLabel: string | null
  openIssues: IssueRow[]
  history: IssueRow[]
  events: AssetEventRow[]
}

/** Everything the tap dialog needs: open issues first, then full history. */
export async function getAssetDetail(
  supabase: ServerSupabase,
  assetId: string,
): Promise<AssetDetail | null> {
  const { data: asset } = await supabase
    .from("dasher_boards_assets")
    .select("*")
    .eq("id", assetId)
    .maybeSingle()
  if (!asset) return null

  let subtypeLabel: string | null = null
  if (asset.subtype_id) {
    const { data: subtype } = await supabase
      .from("dasher_boards_asset_subtypes")
      .select("label")
      .eq("id", asset.subtype_id)
      .maybeSingle()
    subtypeLabel = subtype?.label ?? null
  }

  const { data: issues } = await supabase
    .from("dasher_boards_issues")
    .select("*")
    .eq("asset_id", assetId)
    .order("created_at", { ascending: false })

  const { data: events } = await supabase
    .from("dasher_boards_asset_events")
    .select("*")
    .eq("asset_id", assetId)
    .order("created_at", { ascending: false })

  const all = issues ?? []
  return {
    asset,
    subtypeLabel,
    openIssues: all.filter((i) => i.resolved_at === null),
    history: all.filter((i) => i.resolved_at !== null),
    events: events ?? [],
  }
}

export type DueChecklistItem = ChecklistItemRow & { due: boolean }

export type DueChecklist = {
  todayKey: string
  items: DueChecklistItem[]
  dueItemIds: string[]
}

/**
 * Due-ness computed server-side (the cadence rules live in compute.ts):
 * daily always; weekly on the rink's inspection_weekday; monthly when no
 * completed walk exists yet this facility-local calendar month; yearly in the
 * item's due_month until answered in a completed walk this month.
 * `dateKey` (YYYY-MM-DD) overrides "today" for testing.
 */
export async function getDueChecklist(
  supabase: ServerSupabase,
  rinkId: string,
  dateKey?: string,
): Promise<DueChecklist | null> {
  const { data: rink } = await supabase
    .from("dasher_boards_rinks")
    .select("id, facility_id, inspection_weekday")
    .eq("id", rinkId)
    .maybeSingle()
  if (!rink) return null

  const { data: facility } = await supabase
    .from("facilities")
    .select("timezone")
    .eq("id", rink.facility_id)
    .maybeSingle()

  const todayKey = dateKey ?? dayKeyInTz(new Date(), facility?.timezone ?? null)

  const { data: items } = await supabase
    .from("dasher_boards_checklist_items")
    .select("*")
    .eq("rink_id", rinkId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
  if (!items || items.length === 0) {
    return { todayKey, items: [], dueItemIds: [] }
  }

  // Completed walks in a window generously covering the current facility-local
  // month; bucketed onto facility-local day keys before the month comparison.
  const windowStart = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)
  const { data: walks } = await supabase
    .from("dasher_boards_inspections")
    .select("id, completed_at")
    .eq("rink_id", rinkId)
    .not("completed_at", "is", null)
    .gte("completed_at", windowStart.toISOString())

  const monthPrefix = todayKey.slice(0, 7)
  const completedWalkDayKeys: string[] = []
  const walkIdsThisMonth: string[] = []
  for (const w of walks ?? []) {
    if (!w.completed_at) continue
    const key = dayKeyInTz(w.completed_at, facility?.timezone ?? null)
    completedWalkDayKeys.push(key)
    if (key.slice(0, 7) === monthPrefix) walkIdsThisMonth.push(w.id)
  }

  const answered = new Set<string>()
  if (walkIdsThisMonth.length > 0) {
    const { data: responses } = await supabase
      .from("dasher_boards_checklist_responses")
      .select("item_id")
      .in("inspection_id", walkIdsThisMonth)
    for (const r of responses ?? []) answered.add(r.item_id)
  }

  const due = computeDueItemIds({
    items: items.map((i) => ({
      id: i.id,
      cadence: i.cadence as Cadence,
      due_month: i.due_month,
    })),
    todayKey,
    todayWeekday: weekdayOfKey(todayKey),
    inspectionWeekday: rink.inspection_weekday,
    completedWalkDayKeys,
    answeredItemIdsThisMonth: answered,
  })

  return {
    todayKey,
    items: items.map((i) => ({ ...i, due: due.has(i.id) })),
    dueItemIds: items.filter((i) => due.has(i.id)).map((i) => i.id),
  }
}

export type InspectionStatus = {
  lastCompletedAt: string | null
  lastInspectorName: string | null
  openCounts: Record<IssueSeverity, number>
  walkedToday: boolean
}

/** Powers the module-landing status header (indicator only; blocks nothing). */
export async function getInspectionStatus(
  supabase: ServerSupabase,
  rinkId: string,
): Promise<InspectionStatus | null> {
  const { data: rink } = await supabase
    .from("dasher_boards_rinks")
    .select("id, facility_id")
    .eq("id", rinkId)
    .maybeSingle()
  if (!rink) return null

  const { data: facility } = await supabase
    .from("facilities")
    .select("timezone")
    .eq("id", rink.facility_id)
    .maybeSingle()

  const { data: lastWalk } = await supabase
    .from("dasher_boards_inspections")
    .select("completed_at, inspector_id")
    .eq("rink_id", rinkId)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  let lastInspectorName: string | null = null
  if (lastWalk?.inspector_id) {
    const { data: emp } = await supabase
      .from("employees")
      .select("first_name, last_name")
      .eq("id", lastWalk.inspector_id)
      .maybeSingle()
    if (emp) lastInspectorName = `${emp.first_name} ${emp.last_name}`.trim()
  }

  const { data: open } = await supabase
    .from("dasher_boards_issues")
    .select("severity")
    .eq("rink_id", rinkId)
    .is("resolved_at", null)

  const openCounts: Record<IssueSeverity, number> = { a: 0, b: 0, c: 0 }
  for (const row of open ?? []) {
    const s = row.severity as IssueSeverity
    openCounts[s] += 1
  }

  const tz = facility?.timezone ?? null
  const walkedToday =
    !!lastWalk?.completed_at &&
    dayKeyInTz(lastWalk.completed_at, tz) === dayKeyInTz(new Date(), tz)

  return {
    lastCompletedAt: lastWalk?.completed_at ?? null,
    lastInspectorName,
    openCounts,
    walkedToday,
  }
}
