import "server-only"

import { createClient } from "@/lib/supabase/server"
import { getCommunicationsUnreadCount } from "@/lib/communications/unread"
import { getSchedulingBadgeCount } from "@/lib/scheduling/unread"
import {
  latestCheckStatus,
  type AssetCheckLite,
} from "@/app/reports/dasher-boards/_lib/compute"

// =============================================================================
// Dashboard module status ("monitoring lights")
//
// Read-only feature: for the caller's facility, derive a red / green / none
// status per module from the LATEST report/reading (or, for incidents and
// accidents, a count of items needing attention). NO write path is introduced.
//
// Invariants honored here:
//   * facility_id is ALWAYS server-injected — the caller passes the facility id
//     it already resolved server-side (never a client value), and every query
//     is additionally scoped by RLS via current_facility_id(). A cross-facility
//     read returns nothing.
//   * Thresholds are NEVER hardcoded. Each module's "negative" condition is a
//     flag that was persisted at submit time against the facility's then-active
//     admin-configured / jurisdiction-aware thresholds (refrigeration_thresholds,
//     air_quality_thresholds, ice_depth_settings, ice_operations checklist
//     items). We read those persisted flags rather than re-evaluating ranges.
//   * Offline-first / resilient: any failure for an individual module degrades
//     to "no bubble" (an absent key); this function never throws to the caller.
// =============================================================================

export type ModuleStatusState = "red" | "green"

export type ModuleStatus = {
  state: ModuleStatusState
  /**
   * Count of items needing attention. Present only for the count-style modules
   * (incidents, accidents); omitted for the boolean latest-record modules.
   */
  count?: number
  /**
   * Singular noun for the count in the bubble's accessible label. Defaults to
   * "report"; scheduling counts alerts and open shifts, not reports.
   */
  countNoun?: string
}

/** Keyed by the dashboard ModuleKey strings. Absent key ⇒ no bubble. */
export type DashboardStatusMap = Partial<Record<string, ModuleStatus>>

type Client = Awaited<ReturnType<typeof createClient>>

/**
 * Accident tile red window. Accidents have no status / reviewed_at column and
 * this is a read-only feature (no "mark reviewed" write path), so "needs
 * attention" is proxied by recency: accidents submitted within this window.
 */
const ACCIDENT_RECENT_DAYS = 2

/** Run a per-module read, swallowing any error into `null` (⇒ no bubble). */
async function settle<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch {
    return null
  }
}

// ── Boolean latest-record modules ────────────────────────────────────────────

async function refrigerationStatus(
  supabase: Client,
  facilityId: string,
): Promise<ModuleStatus | null> {
  const { data: latest } = await supabase
    .from("refrigeration_reports")
    .select("id")
    .eq("facility_id", facilityId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!latest) return null

  // refrigeration_reports carries no rollup flag; a report is "red" when any of
  // its captured values was flagged out of range at submit time.
  const { count } = await supabase
    .from("refrigeration_report_values")
    .select("id", { count: "exact", head: true })
    .eq("report_id", latest.id)
    .eq("is_out_of_range", true)

  return { state: (count ?? 0) > 0 ? "red" : "green" }
}

async function airQualityStatus(
  supabase: Client,
  facilityId: string,
): Promise<ModuleStatus | null> {
  // Reports are per-location; "latest" = most recent submission facility-wide.
  const { data } = await supabase
    .from("air_quality_reports")
    .select("has_exceedance")
    .eq("facility_id", facilityId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  return { state: data.has_exceedance ? "red" : "green" }
}

async function iceOperationsStatus(
  supabase: Client,
  facilityId: string,
): Promise<ModuleStatus | null> {
  // has_failed_check is the persisted circle-check rollup; non-circle-check
  // operations always carry false ⇒ green.
  const { data } = await supabase
    .from("ice_operations_submissions")
    .select("has_failed_check")
    .eq("facility_id", facilityId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  return { state: data.has_failed_check ? "red" : "green" }
}

async function iceDepthStatus(
  supabase: Client,
  facilityId: string,
): Promise<ModuleStatus | null> {
  const { data: session } = await supabase
    .from("ice_depth_sessions")
    .select("has_low_reading, has_high_reading")
    .eq("facility_id", facilityId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!session) return null

  // Honor the facility's admin-configured alert_on setting (low | high | any).
  // Defaults to the schema default ('low') when no settings row exists.
  const { data: settings } = await supabase
    .from("ice_depth_settings")
    .select("alert_on")
    .eq("facility_id", facilityId)
    .limit(1)
    .maybeSingle()
  const alertOn = settings?.alert_on ?? "low"

  const low = session.has_low_reading
  const high = session.has_high_reading
  const red =
    (alertOn === "low" && low) ||
    (alertOn === "high" && high) ||
    (alertOn === "any" && (low || high))

  return { state: red ? "red" : "green" }
}

// ── Count-style modules (red + count, else no bubble) ────────────────────────

async function incidentsStatus(
  supabase: Client,
  facilityId: string,
): Promise<ModuleStatus | null> {
  // "Unread" = not yet marked reviewed by an admin.
  const { count } = await supabase
    .from("incident_reports")
    .select("id", { count: "exact", head: true })
    .eq("facility_id", facilityId)
    .is("reviewed_at", null)
  const n = count ?? 0
  return n > 0 ? { state: "red", count: n } : null
}

/**
 * Communications is per-user, not per-facility: unread message deliveries for
 * the session user plus unresolved ack-required alerts they haven't
 * acknowledged. Uses the shared badge helper (which fails to 0 ⇒ no bubble).
 */
async function communicationsStatus(
  facilityId: string,
): Promise<ModuleStatus | null> {
  const n = await getCommunicationsUnreadCount(facilityId)
  return n > 0 ? { state: "red", count: n } : null
}

/**
 * Scheduling is per-user like communications: unread schedule notifications
 * plus shifts open for this person to pick up. Uses the shared badge helper
 * (which fails to 0 => no bubble).
 */
async function schedulingStatus(
  facilityId: string,
): Promise<ModuleStatus | null> {
  const n = await getSchedulingBadgeCount(facilityId)
  return n > 0 ? { state: "red", count: n, countNoun: "item" } : null
}

async function accidentsStatus(
  supabase: Client,
  facilityId: string,
): Promise<ModuleStatus | null> {
  const cutoff = new Date(
    Date.now() - ACCIDENT_RECENT_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()
  const { count } = await supabase
    .from("accident_reports")
    .select("id", { count: "exact", head: true })
    .eq("facility_id", facilityId)
    .gte("submitted_at", cutoff)
  const n = count ?? 0
  return n > 0 ? { state: "red", count: n } : null
}

/**
 * Dasher Boards: open severity-A (safety-critical) perimeter issues, PLUS
 * walk checks marked Fail that aren't already covered by an open issue on
 * the same asset (any severity). This mirrors the diagram's "flagged"
 * condition (see combineDisplayCondition in reports/dasher-boards/_lib/
 * compute.ts) — a Fail with no open issue is still something nobody has
 * acted on, so it counts toward the same red bubble as B/C issues do NOT:
 * routine carry-forward B/C work alone still doesn't light this up, but an
 * un-actioned Fail is a check nobody has turned into a tracked issue yet.
 * There's no state between "red" and "green" in this dashboard's model
 * (StatusBubble only ever renders one of the two), so both trigger types
 * fold into one "red" count rather than inventing an intermediate state.
 */
async function dasherBoardsStatus(
  supabase: Client,
  facilityId: string,
): Promise<ModuleStatus | null> {
  const { count: severityACount } = await supabase
    .from("dasher_boards_issues")
    .select("id", { count: "exact", head: true })
    .eq("facility_id", facilityId)
    .eq("severity", "a")
    .is("resolved_at", null)

  // Every inspection (walk) at this facility — a check's "latest" status is
  // read the same way the diagram reads it: regardless of which walk (open
  // or completed) it came from.
  const { data: inspections } = await supabase
    .from("dasher_boards_inspections")
    .select("id")
    .eq("facility_id", facilityId)
  const inspectionIds = (inspections ?? []).map((i) => i.id)

  let flaggedCount = 0
  if (inspectionIds.length > 0) {
    const { data: checks } = await supabase
      .from("dasher_boards_asset_checks")
      .select("asset_id, status, created_at, updated_at")
      .in("inspection_id", inspectionIds)

    const byAsset = new Map<string, AssetCheckLite[]>()
    for (const c of checks ?? []) {
      const list = byAsset.get(c.asset_id) ?? []
      list.push({
        assetId: c.asset_id,
        status: c.status as "pass" | "fail",
        effectiveAt: c.updated_at ?? c.created_at,
      })
      byAsset.set(c.asset_id, list)
    }
    const failedAssetIds = [...byAsset.entries()]
      .filter(([, list]) => latestCheckStatus(list) === "fail")
      .map(([assetId]) => assetId)

    if (failedAssetIds.length > 0) {
      const [{ data: activeAssets }, { data: openIssueAssets }] = await Promise.all([
        supabase
          .from("dasher_boards_assets")
          .select("id")
          .eq("facility_id", facilityId)
          .eq("is_active", true)
          .in("id", failedAssetIds),
        supabase
          .from("dasher_boards_issues")
          .select("asset_id")
          .eq("facility_id", facilityId)
          .in("asset_id", failedAssetIds)
          .is("resolved_at", null),
      ])
      const activeIds = new Set((activeAssets ?? []).map((a) => a.id))
      const coveredIds = new Set(
        (openIssueAssets ?? []).map((r) => r.asset_id).filter((v): v is string => !!v),
      )
      flaggedCount = failedAssetIds.filter(
        (id) => activeIds.has(id) && !coveredIds.has(id),
      ).length
    }
  }

  const n = (severityACount ?? 0) + flaggedCount
  return n > 0 ? { state: "red", count: n } : null
}

/**
 * Build the dashboard status map for a facility. `facilityId` MUST be a
 * server-resolved value (never client-supplied). Returns `{}` on a missing
 * facility or wholesale failure so the dashboard degrades to "no bubbles"
 * rather than crashing.
 */
export async function getDashboardModuleStatus(
  facilityId: string | null | undefined,
): Promise<DashboardStatusMap> {
  if (!facilityId) return {}

  const supabase = await settle(() => createClient())
  if (!supabase) return {}

  const [
    refrigeration,
    air_quality,
    ice_operations,
    ice_depth,
    incident_reports,
    accident_reports,
    communications,
    dasher_boards,
    scheduling,
  ] = await Promise.all([
    settle(() => refrigerationStatus(supabase, facilityId)),
    settle(() => airQualityStatus(supabase, facilityId)),
    settle(() => iceOperationsStatus(supabase, facilityId)),
    settle(() => iceDepthStatus(supabase, facilityId)),
    settle(() => incidentsStatus(supabase, facilityId)),
    settle(() => accidentsStatus(supabase, facilityId)),
    settle(() => communicationsStatus(facilityId)),
    settle(() => dasherBoardsStatus(supabase, facilityId)),
    settle(() => schedulingStatus(facilityId)),
  ])

  const map: DashboardStatusMap = {}
  if (refrigeration) map.refrigeration = refrigeration
  if (air_quality) map.air_quality = air_quality
  if (ice_operations) map.ice_operations = ice_operations
  if (ice_depth) map.ice_depth = ice_depth
  if (incident_reports) map.incident_reports = incident_reports
  if (accident_reports) map.accident_reports = accident_reports
  if (communications) map.communications = communications
  if (dasher_boards) map.dasher_boards = dasher_boards
  if (scheduling) map.scheduling = scheduling
  return map
}
