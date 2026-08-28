import "server-only"

import type { createClient } from "@/lib/supabase/server"
import type { Tables } from "@/types/database"
import { dayKeyInTz, formatInTz, weekdayOfKey } from "@/lib/timezone"

import {
  combineAssetAndChildCheckStatus,
  computeDueItemIds,
  latestCheckStatus,
  worstOpenSeverity,
  type AssetCheckLite,
  type AssetCheckStatus,
  type Cadence,
  type IssueSeverity,
} from "./compute"
import {
  computeGlassNumbers,
  positionsFromAssets,
  schemeFromRink,
  type NumberedAssetRow,
} from "./glass-numbering"
import { resolveSegmentLabel } from "./display-label"
import type { SegmentHistoryRow } from "./segment-history-csv"

/**
 * A rink's glass numbers as a plain object, ready to hand to a client
 * component. Empty when the rink hasn't enabled numbering.
 */
export function resolveRinkGlassNumbers(
  rink: Pick<
    RinkRow,
    | "glass_numbering_enabled"
    | "glass_number_prefix"
    | "glass_number_start"
    | "glass_number_direction"
    | "glass_number_anchor_offset"
    | "glass_number_include_doors"
    | "perimeter_direction"
    | "perimeter_anchor_offset"
  >,
  assets: readonly NumberedAssetRow[],
): Record<string, string> {
  return Object.fromEntries(
    computeGlassNumbers(
      positionsFromAssets(assets),
      schemeFromRink(rink),
      rink.perimeter_direction as "clockwise" | "counterclockwise",
      rink.perimeter_anchor_offset,
    ),
  )
}

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
  /** This asset's own latest walk check (any inspection, open or completed). */
  latest_check_status: AssetCheckStatus | null
}

export type RinkPerimeter = {
  rink: RinkRow
  assets: PerimeterAsset[]
  /**
   * The facility's own glass numbers, keyed by BOTH the position id and its
   * glass child id (see computeGlassNumbers). Empty when the rink hasn't
   * turned numbering on — every surface then falls back to `label`, exactly as
   * it did before the feature existed.
   */
  glassNumbers: Record<string, string>
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
  if (!assets) return { rink, assets: [], glassNumbers: {} }

  const { data: openIssues } = await supabase
    .from("dasher_boards_issues")
    .select("asset_id, severity")
    .eq("rink_id", rinkId)
    .is("resolved_at", null)
    .not("asset_id", "is", null)

  // Every inspection (walk) ever run on this rink, open or completed — a
  // check's "latest" status doesn't care which walk it came from, only when
  // it was recorded (dasher_boards_asset_checks has no rink_id of its own,
  // so join through inspections).
  const { data: inspections } = await supabase
    .from("dasher_boards_inspections")
    .select("id")
    .eq("rink_id", rinkId)
  const inspectionIds = (inspections ?? []).map((i) => i.id)

  let assetChecks: Array<{
    asset_id: string
    status: string
    created_at: string
    updated_at: string | null
  }> = []
  if (inspectionIds.length > 0) {
    const { data } = await supabase
      .from("dasher_boards_asset_checks")
      .select("asset_id, status, created_at, updated_at")
      .in("inspection_id", inspectionIds)
    assetChecks = data ?? []
  }

  // Glass rows have no segment of their own — an open issue (or a fail check)
  // on G12 must color the B12 position on the diagram. Attribute glass rows
  // to BOTH the glass row itself (its own rollup, for the dialog) and its
  // parent board (the segment).
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

  // Each asset's OWN check history only (no cross-asset merging) — a later
  // check correctly supersedes an earlier one, but only within the SAME
  // asset's own timeline. Board and glass are different physical pieces, so
  // their histories are resolved independently here and combined afterward
  // via `combineAssetAndChildCheckStatus` (fail-wins), not merged into one
  // time-sorted list — see that function's doc comment for why.
  const ownCheckRollup = new Map<string, AssetCheckLite[]>()
  for (const row of assetChecks) {
    const list = ownCheckRollup.get(row.asset_id) ?? []
    list.push({
      assetId: row.asset_id,
      status: row.status as AssetCheckStatus,
      effectiveAt: row.updated_at ?? row.created_at,
    })
    ownCheckRollup.set(row.asset_id, list)
  }
  const ownLatestCheck = new Map<string, AssetCheckStatus | null>()
  for (const a of assets) {
    ownLatestCheck.set(a.id, latestCheckStatus(ownCheckRollup.get(a.id) ?? []))
  }
  // Reverse of glassParent: a board's own glass child id, for the segment
  // combine below (glass rows don't need this — they display their own
  // status only, same asymmetry as the issue rollup above).
  const glassChildOf = new Map<string, string>()
  for (const [glassId, boardId] of glassParent) {
    glassChildOf.set(boardId, glassId)
  }

  return {
    rink,
    // Resolved once here so every staff surface prints the same value.
    glassNumbers: resolveRinkGlassNumbers(rink, assets),
    assets: assets.map((a) => {
      const sevs = rollup.get(a.id) ?? []
      const own = ownLatestCheck.get(a.id) ?? null
      const childId = glassChildOf.get(a.id)
      const latest_check_status = childId
        ? combineAssetAndChildCheckStatus(own, ownLatestCheck.get(childId) ?? null)
        : own
      return {
        ...a,
        open_count: sevs.length,
        worst_open_severity: worstOpenSeverity(sevs),
        latest_check_status,
      }
    }),
  }
}

export type AssetDetail = {
  asset: AssetRow
  subtypeLabel: string | null
  /**
   * The asset's zone name (dasher_boards_zones.name), resolved server-side
   * since `asset` only carries zone_id. Null = no zone assigned (or the zone
   * was deleted — zone_id would already be null then too, via ON DELETE SET
   * NULL).
   */
  zoneName: string | null
  openIssues: IssueRow[]
  /**
   * Resolved issues. Each row's `label_snapshot` (migration 257) is the
   * asset's display label AT LOG TIME — server-derived, frozen on update —
   * so a caller can show "logged as X" when a later rename means it no
   * longer matches the asset's current display label.
   */
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

  let zoneName: string | null = null
  if (asset.zone_id) {
    const { data: zone } = await supabase
      .from("dasher_boards_zones")
      .select("name")
      .eq("id", asset.zone_id)
      .maybeSingle()
    zoneName = zone?.name ?? null
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
    zoneName,
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

// ---------------------------------------------------------------------------
// Per-segment inspection history (the exportable ORFA liability artifact)
// ---------------------------------------------------------------------------

/**
 * Every walk check and every issue ever recorded on the rink, one row per
 * record, shaped for the CSV export (segment-history-csv.ts). Labels resolve
 * to TODAY's display name; `loggedAsLabel` carries the label_snapshot when it
 * differs, so a renamed segment's history still reads as it was written.
 * Timestamps are formatted in the facility's zone (the server runs in UTC —
 * never format without an explicit zone). All reads run under the caller's
 * RLS; a foreign rink id resolves to null.
 */
export async function getSegmentHistory(
  supabase: ServerSupabase,
  rinkId: string,
): Promise<SegmentHistoryRow[] | null> {
  const perimeter = await getRinkPerimeter(supabase, rinkId)
  if (!perimeter) return null
  const { rink, assets, glassNumbers } = perimeter

  const [facilityRes, zonesRes, inspectionsRes, categoriesRes] =
    await Promise.all([
      supabase
        .from("facilities")
        .select("timezone")
        .eq("id", rink.facility_id)
        .maybeSingle(),
      supabase
        .from("dasher_boards_zones")
        .select("id, name")
        .eq("rink_id", rinkId),
      supabase
        .from("dasher_boards_inspections")
        .select("id, inspection_kind, contractor_name, inspector_id")
        .eq("rink_id", rinkId),
      supabase
        .from("dasher_boards_issue_categories")
        .select("id, label")
        .eq("facility_id", rink.facility_id),
    ])

  const tz = facilityRes.data?.timezone ?? null
  const zoneName = new Map(
    (zonesRes.data ?? []).map((z) => [z.id, z.name] as const),
  )
  const inspectionById = new Map(
    (inspectionsRes.data ?? []).map((i) => [i.id, i] as const),
  )
  const categoryLabel = new Map(
    (categoriesRes.data ?? []).map((c) => [c.id, c.label] as const),
  )
  const assetById = new Map(assets.map((a) => [a.id, a] as const))

  const inspectionIds = [...inspectionById.keys()]
  const [checksRes, issuesRes] = await Promise.all([
    inspectionIds.length > 0
      ? supabase
          .from("dasher_boards_asset_checks")
          .select(
            "asset_id, inspection_id, status, note, checked_by, created_at, label_snapshot",
          )
          .in("inspection_id", inspectionIds)
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from("dasher_boards_issues")
      .select(
        "asset_id, severity, description, category_id, reported_by, created_at, resolved_at, label_snapshot",
      )
      .eq("rink_id", rinkId)
      .not("asset_id", "is", null),
  ])
  const checks = checksRes.data ?? []
  const issues = issuesRes.data ?? []

  // One name lookup for everyone the records mention.
  const personIds = new Set<string>()
  for (const c of checks) if (c.checked_by) personIds.add(c.checked_by)
  for (const i of issues) if (i.reported_by) personIds.add(i.reported_by)
  for (const i of inspectionById.values()) {
    if (i.inspector_id) personIds.add(i.inspector_id)
  }
  const personName = new Map<string, string>()
  if (personIds.size > 0) {
    const { data: people } = await supabase
      .from("employees")
      .select("id, first_name, last_name")
      .in("id", [...personIds])
    for (const p of people ?? []) {
      personName.set(p.id, `${p.first_name} ${p.last_name}`.trim())
    }
  }

  const unsorted: Array<{ at: string; row: SegmentHistoryRow }> = []

  for (const check of checks) {
    const asset = assetById.get(check.asset_id)
    if (!asset) continue
    const inspection = inspectionById.get(check.inspection_id)
    const { display, identity } = resolveSegmentLabel(asset, glassNumbers)
    unsorted.push({
      at: check.created_at,
      row: {
        occurredAt: formatInTz(check.created_at, tz),
        rinkName: rink.name,
        segmentDisplayLabel: display,
        segmentIdentityLabel: identity,
        loggedAsLabel:
          check.label_snapshot && check.label_snapshot !== display
            ? check.label_snapshot
            : null,
        zoneName: asset.zone_id ? (zoneName.get(asset.zone_id) ?? null) : null,
        recordType: "walk_check",
        inspectionKind:
          inspection?.inspection_kind === "annual_contractor"
            ? "annual_contractor"
            : "routine",
        contractorName: inspection?.contractor_name ?? null,
        outcome: check.status,
        category: null,
        detail: check.note,
        recordedBy: check.checked_by
          ? (personName.get(check.checked_by) ?? null)
          : null,
        resolvedAt: null,
      },
    })
  }

  for (const issue of issues) {
    if (!issue.asset_id) continue
    const asset = assetById.get(issue.asset_id)
    if (!asset) continue
    const { display, identity } = resolveSegmentLabel(asset, glassNumbers)
    unsorted.push({
      at: issue.created_at,
      row: {
        occurredAt: formatInTz(issue.created_at, tz),
        rinkName: rink.name,
        segmentDisplayLabel: display,
        segmentIdentityLabel: identity,
        loggedAsLabel:
          issue.label_snapshot && issue.label_snapshot !== display
            ? issue.label_snapshot
            : null,
        zoneName: asset.zone_id ? (zoneName.get(asset.zone_id) ?? null) : null,
        recordType: "issue",
        inspectionKind: null,
        contractorName: null,
        outcome: issue.severity,
        category: issue.category_id
          ? (categoryLabel.get(issue.category_id) ?? null)
          : null,
        detail: issue.description,
        recordedBy: issue.reported_by
          ? (personName.get(issue.reported_by) ?? null)
          : null,
        resolvedAt: issue.resolved_at ? formatInTz(issue.resolved_at, tz) : null,
      },
    })
  }

  unsorted.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  return unsorted.map((e) => e.row)
}
