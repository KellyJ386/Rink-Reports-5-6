import "server-only"

import type { createClient } from "@/lib/supabase/server"
import { dbError } from "@/lib/db-error"
import { dayKeyInTz } from "@/lib/timezone"

import {
  isIssueSeverity,
  isUuid,
  type IssueSeverity,
} from "./compute"
import { getDueChecklist } from "./queries"

type ServerSupabase = Awaited<ReturnType<typeof createClient>>

// All writers here take (supabase, { employeeId, facilityId, ... }) like
// persistIceDepth so the online server actions and a future offline replay
// handler share one code path. Authorization (submit/edit grants) is verified
// by the callers; RLS + guard triggers independently re-enforce everything
// server-side.

export type PersistResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export type IssueReportInput = {
  /** Exactly one of assetId (spatial) / checklistItemId (non-spatial). */
  assetId: string | null
  checklistItemId: string | null
  categoryId: string | null
  description: string
  severity: IssueSeverity
  actionTaken: string | null
  supervisorId: string | null
  /** Explicit walk link (offline replay); when omitted the caller's open walk
   *  on the asset's rink is auto-linked. */
  inspectionId?: string | null
}

export function parseIssueReportInput(payload: unknown): IssueReportInput | null {
  if (typeof payload !== "object" || payload === null) return null
  const p = payload as Record<string, unknown>
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null

  const assetId = str(p.assetId)
  const checklistItemId = str(p.checklistItemId)
  const description = str(p.description)
  const severity = str(p.severity)
  if (!description || !severity || !isIssueSeverity(severity)) return null
  if ((assetId === null) === (checklistItemId === null)) return null
  if (assetId && !isUuid(assetId)) return null
  if (checklistItemId && !isUuid(checklistItemId)) return null

  const categoryId = str(p.categoryId)
  const supervisorId = str(p.supervisorId)
  const inspectionId = str(p.inspectionId)
  if (categoryId && !isUuid(categoryId)) return null
  if (supervisorId && !isUuid(supervisorId)) return null
  if (inspectionId && !isUuid(inspectionId)) return null

  return {
    assetId,
    checklistItemId,
    categoryId,
    description,
    severity,
    actionTaken: str(p.actionTaken),
    supervisorId,
    inspectionId,
  }
}

export async function persistIssueReport(
  supabase: ServerSupabase,
  args: {
    employeeId: string
    facilityId: string
    input: IssueReportInput
    // Offline-queue local id, threaded on replay so a crash-window re-drive is
    // idempotent (online callers omit it). Deduped against source_local_id.
    sourceLocalId?: string | null
  },
): Promise<PersistResult<{ issueId: string }>> {
  const { employeeId, facilityId, input } = args
  const sourceLocalId = args.sourceLocalId ?? null

  if ((input.assetId === null) === (input.checklistItemId === null)) {
    return { ok: false, error: "An issue targets exactly one asset or checklist item." }
  }

  // Severity A: supervisor + action taken are hard requirements (app layer;
  // the supervisor half is also a DB check constraint).
  if (input.severity === "a") {
    if (!input.supervisorId) {
      return { ok: false, error: "Severity A issues require a supervisor." }
    }
    if (!input.actionTaken) {
      return { ok: false, error: "Severity A issues require the action taken." }
    }
  }

  if (input.supervisorId) {
    const { data: supervisor } = await supabase
      .from("employees")
      .select("id")
      .eq("id", input.supervisorId)
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .maybeSingle()
    if (!supervisor) {
      return { ok: false, error: "Supervisor not found at your facility." }
    }
  }

  let rinkId: string

  if (input.assetId) {
    const { data: asset } = await supabase
      .from("dasher_boards_assets")
      .select("id, rink_id, facility_id, asset_type, is_active")
      .eq("id", input.assetId)
      .maybeSingle()
    if (!asset || asset.facility_id !== facilityId) {
      return { ok: false, error: "Asset not found." }
    }
    if (!asset.is_active) {
      // A retired asset has no diagram dot and no dialog — an issue landing
      // on it would be unreachable for acknowledge/resolve.
      return { ok: false, error: "This asset is retired; report the issue on its replacement." }
    }
    rinkId = asset.rink_id

    // Spatial issues require a category quick-pick matching the asset type.
    if (!input.categoryId) {
      return { ok: false, error: "Pick an issue category." }
    }
    const { data: category } = await supabase
      .from("dasher_boards_issue_categories")
      .select("id, asset_type, facility_id, is_active")
      .eq("id", input.categoryId)
      .maybeSingle()
    if (
      !category ||
      category.facility_id !== facilityId ||
      category.asset_type !== asset.asset_type ||
      !category.is_active
    ) {
      return { ok: false, error: "Invalid category for this asset." }
    }
  } else {
    const { data: item } = await supabase
      .from("dasher_boards_checklist_items")
      .select("id, rink_id, facility_id, is_active")
      .eq("id", input.checklistItemId!)
      .maybeSingle()
    if (!item || item.facility_id !== facilityId || !item.is_active) {
      return { ok: false, error: "Checklist item not found." }
    }
    rinkId = item.rink_id
    if (input.categoryId) {
      return { ok: false, error: "Checklist issues don't take a category." }
    }
  }

  // Link the caller's open walk on this rink (explicit id wins, verified).
  let inspectionId: string | null = null
  if (input.inspectionId) {
    const { data: walk } = await supabase
      .from("dasher_boards_inspections")
      .select("id")
      .eq("id", input.inspectionId)
      .eq("rink_id", rinkId)
      .eq("inspector_id", employeeId)
      .is("completed_at", null)
      .maybeSingle()
    if (!walk) {
      return { ok: false, error: "That walk is no longer open." }
    }
    inspectionId = walk.id
  } else {
    const { data: walk } = await supabase
      .from("dasher_boards_inspections")
      .select("id")
      .eq("rink_id", rinkId)
      .eq("inspector_id", employeeId)
      .is("completed_at", null)
      .maybeSingle()
    inspectionId = walk?.id ?? null
  }

  // Idempotency: a queued report_issue that already landed (crash-window
  // re-drive) is a no-op — return the existing row instead of a duplicate.
  if (sourceLocalId) {
    const { data: existing } = await supabase
      .from("dasher_boards_issues")
      .select("id")
      .eq("rink_id", rinkId)
      .eq("source_local_id", sourceLocalId)
      .maybeSingle()
    if (existing) return { ok: true, issueId: existing.id }
  }

  const { data: inserted, error } = await supabase
    .from("dasher_boards_issues")
    .insert({
      facility_id: facilityId,
      rink_id: rinkId,
      asset_id: input.assetId,
      checklist_item_id: input.checklistItemId,
      category_id: input.categoryId,
      description: input.description,
      severity: input.severity,
      action_taken: input.actionTaken,
      reported_by: employeeId,
      inspection_id: inspectionId,
      supervisor_id: input.supervisorId,
      source_local_id: sourceLocalId,
    })
    .select("id")
    .single()
  if (error || !inserted) {
    return { ok: false, error: dbError(error, "Failed to report the issue.") }
  }
  return { ok: true, issueId: inserted.id }
}

/** Sets supervisor acknowledgment. Caller must hold the module edit grant. */
export async function acknowledgeIssue(
  supabase: ServerSupabase,
  args: { facilityId: string; issueId: string },
): Promise<PersistResult> {
  const { data, error } = await supabase
    .from("dasher_boards_issues")
    .update({ supervisor_ack_at: new Date().toISOString() })
    .eq("id", args.issueId)
    .eq("facility_id", args.facilityId)
    .is("supervisor_ack_at", null)
    .is("resolved_at", null)
    .select("id")
  if (error) {
    return { ok: false, error: dbError(error, "Failed to acknowledge.") }
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Issue not found, already acknowledged, or already resolved." }
  }
  return { ok: true }
}

/**
 * Resolves an issue. Writes ONLY resolved_by / resolved_at — the DB guard
 * trigger independently rejects any attempt to touch other columns.
 */
export async function resolveIssue(
  supabase: ServerSupabase,
  args: { employeeId: string; facilityId: string; issueId: string },
): Promise<PersistResult> {
  const { data, error } = await supabase
    .from("dasher_boards_issues")
    .update({
      resolved_by: args.employeeId,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", args.issueId)
    .eq("facility_id", args.facilityId)
    .is("resolved_at", null)
    .select("id")
  if (error) {
    return { ok: false, error: dbError(error, "Failed to resolve.") }
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Issue not found or already resolved." }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Inspections (walks)
// ---------------------------------------------------------------------------

export async function startInspection(
  supabase: ServerSupabase,
  args: { employeeId: string; facilityId: string; rinkId: string },
): Promise<PersistResult<{ inspectionId: string; resumed: boolean }>> {
  const { employeeId, facilityId, rinkId } = args

  const { data: rink } = await supabase
    .from("dasher_boards_rinks")
    .select("id, facility_id, is_active")
    .eq("id", rinkId)
    .maybeSingle()
  if (!rink || rink.facility_id !== facilityId) {
    return { ok: false, error: "Rink not found." }
  }

  // One open walk per inspector per rink (also a partial unique index):
  // resuming the existing walk beats a duplicate-key error.
  const { data: existing } = await supabase
    .from("dasher_boards_inspections")
    .select("id")
    .eq("rink_id", rinkId)
    .eq("inspector_id", employeeId)
    .is("completed_at", null)
    .maybeSingle()
  if (existing) {
    return { ok: true, inspectionId: existing.id, resumed: true }
  }

  const { data: inserted, error } = await supabase
    .from("dasher_boards_inspections")
    .insert({
      facility_id: facilityId,
      rink_id: rinkId,
      inspector_id: employeeId,
    })
    .select("id")
    .single()
  if (error || !inserted) {
    return { ok: false, error: dbError(error, "Failed to start the walk.") }
  }
  return { ok: true, inspectionId: inserted.id, resumed: false }
}

export type ChecklistResponseInput = {
  itemId: string
  status: "pass" | "flag"
}

export async function saveChecklistResponses(
  supabase: ServerSupabase,
  args: {
    employeeId: string
    facilityId: string
    inspectionId: string
    responses: ChecklistResponseInput[]
  },
): Promise<PersistResult> {
  const { employeeId, facilityId, inspectionId, responses } = args
  if (responses.length === 0) return { ok: true }
  if (responses.some((r) => !isUuid(r.itemId) || (r.status !== "pass" && r.status !== "flag"))) {
    return { ok: false, error: "Invalid checklist responses." }
  }

  const { data: walk } = await supabase
    .from("dasher_boards_inspections")
    .select("id, rink_id, inspector_id, completed_at")
    .eq("id", inspectionId)
    .eq("facility_id", facilityId)
    .maybeSingle()
  if (!walk || walk.inspector_id !== employeeId) {
    return { ok: false, error: "Walk not found." }
  }
  if (walk.completed_at) {
    return { ok: false, error: "This walk is already signed off." }
  }

  const itemIds = responses.map((r) => r.itemId)
  const { data: items } = await supabase
    .from("dasher_boards_checklist_items")
    .select("id")
    .eq("rink_id", walk.rink_id)
    .in("id", itemIds)
  if ((items?.length ?? 0) !== new Set(itemIds).size) {
    return { ok: false, error: "A checklist item doesn't belong to this rink." }
  }

  const { error } = await supabase
    .from("dasher_boards_checklist_responses")
    .upsert(
      responses.map((r) => ({
        facility_id: facilityId,
        inspection_id: inspectionId,
        item_id: r.itemId,
        status: r.status,
      })),
      { onConflict: "inspection_id,item_id" },
    )
  if (error) {
    return { ok: false, error: dbError(error, "Failed to save responses.") }
  }
  return { ok: true }
}

/**
 * Signs off a walk. Rejects when:
 *  (a) any severity-A issue logged during this walk lacks supervisor ack;
 *  (b) any due checklist item lacks a response;
 *  (c) any flagged response lacks a linked issue.
 * Once completed_at lands, the row is immutable (RLS + guard trigger).
 */
export async function completeInspection(
  supabase: ServerSupabase,
  args: {
    employeeId: string
    facilityId: string
    inspectionId: string
    notes: string | null
  },
): Promise<PersistResult> {
  const { employeeId, facilityId, inspectionId, notes } = args

  const { data: walk } = await supabase
    .from("dasher_boards_inspections")
    .select("id, rink_id, inspector_id, completed_at, started_at")
    .eq("id", inspectionId)
    .eq("facility_id", facilityId)
    .maybeSingle()
  if (!walk || walk.inspector_id !== employeeId) {
    return { ok: false, error: "Walk not found." }
  }
  if (walk.completed_at) {
    return { ok: false, error: "This walk is already signed off." }
  }

  // (a) Unacknowledged severity-A issues from this walk.
  const { data: unackedA } = await supabase
    .from("dasher_boards_issues")
    .select("id")
    .eq("inspection_id", inspectionId)
    .eq("severity", "a")
    .is("supervisor_ack_at", null)
  if ((unackedA?.length ?? 0) > 0) {
    return {
      ok: false,
      error: `${unackedA!.length} severity-A issue(s) still need supervisor acknowledgment before sign-off.`,
    }
  }

  // (b) All due checklist items answered. Due-ness is computed as of the WALK'S
  // day, not "now" — an offline walk replayed days later must be judged against
  // what was due when it was actually performed, or a valid walk gets rejected.
  const { data: tzRow } = await supabase
    .from("facilities")
    .select("timezone")
    .eq("id", facilityId)
    .maybeSingle()
  const walkDayKey = dayKeyInTz(walk.started_at, tzRow?.timezone ?? null)
  const due = await getDueChecklist(supabase, walk.rink_id, walkDayKey)
  if (!due) return { ok: false, error: "Failed to load the due checklist." }
  const { data: answeredRows } = await supabase
    .from("dasher_boards_checklist_responses")
    .select("item_id, status")
    .eq("inspection_id", inspectionId)
  const answered = new Set((answeredRows ?? []).map((r) => r.item_id))
  const missing = due.dueItemIds.filter((id) => !answered.has(id))
  if (missing.length > 0) {
    return {
      ok: false,
      error: `${missing.length} due checklist item(s) still need an answer before sign-off.`,
    }
  }

  // (c) Every flagged response has a linked issue.
  const flagged = (answeredRows ?? []).filter((r) => r.status === "flag")
  if (flagged.length > 0) {
    const { data: walkIssues } = await supabase
      .from("dasher_boards_issues")
      .select("checklist_item_id")
      .eq("inspection_id", inspectionId)
      .not("checklist_item_id", "is", null)
    const linked = new Set(
      (walkIssues ?? []).map((i) => i.checklist_item_id).filter(Boolean),
    )
    const unlinked = flagged.filter((r) => !linked.has(r.item_id))
    if (unlinked.length > 0) {
      return {
        ok: false,
        error: `${unlinked.length} flagged checklist item(s) still need an issue report before sign-off.`,
      }
    }
  }

  const { data, error } = await supabase
    .from("dasher_boards_inspections")
    .update({ completed_at: new Date().toISOString(), notes })
    .eq("id", inspectionId)
    .is("completed_at", null)
    .select("id")
  if (error) {
    return { ok: false, error: dbError(error, "Failed to sign off the walk.") }
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Walk not found or already signed off." }
  }
  return { ok: true }
}
