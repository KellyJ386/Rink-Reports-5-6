"use server"

import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"
import { logServerError } from "@/lib/observability/log-server-error"

import { isUuid } from "./_lib/compute"
import {
  getAssetDetail,
  getDueChecklist,
  getInspectionStatus,
  getRinkPerimeter,
  type AssetDetail,
  type DueChecklist,
  type InspectionStatus,
  type RinkPerimeter,
} from "./_lib/queries"
import {
  acknowledgeIssue,
  completeInspection,
  parseIssueReportInput,
  persistIssueReport,
  resolveIssue,
  saveChecklistResponses,
  startInspection,
  type ChecklistResponseInput,
} from "./_lib/submit"

// Staff-facing actions. Every wrapper resolves the caller's active employee
// row (never trusts a client-provided identity), verifies the module grant for
// the operation's tier (view=read, submit=report+walk, edit=ack/resolve), then
// delegates to the shared _lib/submit.ts persist layer — the same functions a
// future offline replay handler calls. RLS + guard triggers re-enforce all of
// it at the database.

type Ctx =
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; employeeId: string; facilityId: string }
  | { ok: false; error: string }

async function resolveContext(): Promise<Ctx> {
  const current = await requireUser()
  const supabase = await createClient()
  const { data: employeeRow, error } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()
  if (error) {
    return { ok: false, error: "Failed to load your account." }
  }
  if (!employeeRow || !employeeRow.facility_id) {
    return {
      ok: false,
      error: "Your account isn't fully set up yet. Contact your administrator.",
    }
  }
  return {
    ok: true,
    supabase,
    employeeId: employeeRow.id,
    facilityId: employeeRow.facility_id,
  }
}

export type ActionResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string }

const NO_SUBMIT = "You don't have permission to submit in Dasher Boards."
const NO_EDIT =
  "Acknowledging and resolving issues requires the Dasher Boards edit permission."
const NO_VIEW = "You don't have access to Dasher Boards."

// ---------------------------------------------------------------------------
// Reads (view tier) — for client components that can't import server-only code.
// ---------------------------------------------------------------------------

export async function getRinkPerimeterAction(
  rinkId: string,
): Promise<ActionResult<{ perimeter: RinkPerimeter }>> {
  try {
    const ctx = await resolveContext()
    if (!ctx.ok) return ctx
    if (!isUuid(rinkId)) return { ok: false, error: "Invalid rink." }
    if (!(await currentUserCan(ctx.supabase, "dasher_boards", "view"))) {
      return { ok: false, error: NO_VIEW }
    }
    const perimeter = await getRinkPerimeter(ctx.supabase, rinkId)
    if (!perimeter) return { ok: false, error: "Rink not found." }
    return { ok: true, perimeter }
  } catch (e) {
    logServerError("reports/dasher-boards/getRinkPerimeter", e)
    return { ok: false, error: "Failed to load the perimeter." }
  }
}

export async function getAssetDetailAction(
  assetId: string,
): Promise<ActionResult<{ detail: AssetDetail }>> {
  try {
    const ctx = await resolveContext()
    if (!ctx.ok) return ctx
    if (!isUuid(assetId)) return { ok: false, error: "Invalid asset." }
    if (!(await currentUserCan(ctx.supabase, "dasher_boards", "view"))) {
      return { ok: false, error: NO_VIEW }
    }
    const detail = await getAssetDetail(ctx.supabase, assetId)
    if (!detail) return { ok: false, error: "Asset not found." }
    return { ok: true, detail }
  } catch (e) {
    logServerError("reports/dasher-boards/getAssetDetail", e)
    return { ok: false, error: "Failed to load the asset." }
  }
}

export async function getDueChecklistAction(
  rinkId: string,
): Promise<ActionResult<{ checklist: DueChecklist }>> {
  try {
    const ctx = await resolveContext()
    if (!ctx.ok) return ctx
    if (!isUuid(rinkId)) return { ok: false, error: "Invalid rink." }
    if (!(await currentUserCan(ctx.supabase, "dasher_boards", "view"))) {
      return { ok: false, error: NO_VIEW }
    }
    const checklist = await getDueChecklist(ctx.supabase, rinkId)
    if (!checklist) return { ok: false, error: "Rink not found." }
    return { ok: true, checklist }
  } catch (e) {
    logServerError("reports/dasher-boards/getDueChecklist", e)
    return { ok: false, error: "Failed to load the checklist." }
  }
}

export async function getInspectionStatusAction(
  rinkId: string,
): Promise<ActionResult<{ status: InspectionStatus }>> {
  try {
    const ctx = await resolveContext()
    if (!ctx.ok) return ctx
    if (!isUuid(rinkId)) return { ok: false, error: "Invalid rink." }
    if (!(await currentUserCan(ctx.supabase, "dasher_boards", "view"))) {
      return { ok: false, error: NO_VIEW }
    }
    const status = await getInspectionStatus(ctx.supabase, rinkId)
    if (!status) return { ok: false, error: "Rink not found." }
    return { ok: true, status }
  } catch (e) {
    logServerError("reports/dasher-boards/getInspectionStatus", e)
    return { ok: false, error: "Failed to load the walk status." }
  }
}

// ---------------------------------------------------------------------------
// Issue pipeline (submit tier to report; edit tier to ack/resolve)
// ---------------------------------------------------------------------------

export async function reportIssueAction(
  payload: unknown,
): Promise<ActionResult<{ issueId: string }>> {
  try {
    const ctx = await resolveContext()
    if (!ctx.ok) return ctx
    if (!(await currentUserCan(ctx.supabase, "dasher_boards", "submit"))) {
      return { ok: false, error: NO_SUBMIT }
    }
    const input = parseIssueReportInput(payload)
    if (!input) return { ok: false, error: "Invalid issue report." }
    return await persistIssueReport(ctx.supabase, {
      employeeId: ctx.employeeId,
      facilityId: ctx.facilityId,
      input,
    })
  } catch (e) {
    logServerError("reports/dasher-boards/reportIssue", e)
    return { ok: false, error: "Failed to report the issue." }
  }
}

export async function acknowledgeIssueAction(
  issueId: string,
): Promise<ActionResult> {
  try {
    const ctx = await resolveContext()
    if (!ctx.ok) return ctx
    if (!isUuid(issueId)) return { ok: false, error: "Invalid issue." }
    if (!(await currentUserCan(ctx.supabase, "dasher_boards", "edit"))) {
      return { ok: false, error: NO_EDIT }
    }
    return await acknowledgeIssue(ctx.supabase, {
      facilityId: ctx.facilityId,
      issueId,
    })
  } catch (e) {
    logServerError("reports/dasher-boards/acknowledgeIssue", e)
    return { ok: false, error: "Failed to acknowledge." }
  }
}

export async function resolveIssueAction(
  issueId: string,
): Promise<ActionResult> {
  try {
    const ctx = await resolveContext()
    if (!ctx.ok) return ctx
    if (!isUuid(issueId)) return { ok: false, error: "Invalid issue." }
    if (!(await currentUserCan(ctx.supabase, "dasher_boards", "edit"))) {
      return { ok: false, error: NO_EDIT }
    }
    return await resolveIssue(ctx.supabase, {
      employeeId: ctx.employeeId,
      facilityId: ctx.facilityId,
      issueId,
    })
  } catch (e) {
    logServerError("reports/dasher-boards/resolveIssue", e)
    return { ok: false, error: "Failed to resolve." }
  }
}

// ---------------------------------------------------------------------------
// Walk lifecycle (submit tier)
// ---------------------------------------------------------------------------

export async function startWalkAction(
  rinkId: string,
): Promise<ActionResult<{ inspectionId: string; resumed: boolean }>> {
  try {
    const ctx = await resolveContext()
    if (!ctx.ok) return ctx
    if (!isUuid(rinkId)) return { ok: false, error: "Invalid rink." }
    if (!(await currentUserCan(ctx.supabase, "dasher_boards", "submit"))) {
      return { ok: false, error: NO_SUBMIT }
    }
    return await startInspection(ctx.supabase, {
      employeeId: ctx.employeeId,
      facilityId: ctx.facilityId,
      rinkId,
    })
  } catch (e) {
    logServerError("reports/dasher-boards/startWalk", e)
    return { ok: false, error: "Failed to start the walk." }
  }
}

export async function saveChecklistResponsesAction(
  inspectionId: string,
  responses: ChecklistResponseInput[],
): Promise<ActionResult> {
  try {
    const ctx = await resolveContext()
    if (!ctx.ok) return ctx
    if (!isUuid(inspectionId)) return { ok: false, error: "Invalid walk." }
    if (!(await currentUserCan(ctx.supabase, "dasher_boards", "submit"))) {
      return { ok: false, error: NO_SUBMIT }
    }
    return await saveChecklistResponses(ctx.supabase, {
      employeeId: ctx.employeeId,
      facilityId: ctx.facilityId,
      inspectionId,
      responses,
    })
  } catch (e) {
    logServerError("reports/dasher-boards/saveChecklistResponses", e)
    return { ok: false, error: "Failed to save responses." }
  }
}

export async function completeWalkAction(
  inspectionId: string,
  notes?: string,
): Promise<ActionResult> {
  try {
    const ctx = await resolveContext()
    if (!ctx.ok) return ctx
    if (!isUuid(inspectionId)) return { ok: false, error: "Invalid walk." }
    if (!(await currentUserCan(ctx.supabase, "dasher_boards", "submit"))) {
      return { ok: false, error: NO_SUBMIT }
    }
    const trimmed = typeof notes === "string" ? notes.trim() : ""
    return await completeInspection(ctx.supabase, {
      employeeId: ctx.employeeId,
      facilityId: ctx.facilityId,
      inspectionId,
      notes: trimmed.length > 0 ? trimmed : null,
    })
  } catch (e) {
    logServerError("reports/dasher-boards/completeWalk", e)
    return { ok: false, error: "Failed to sign off the walk." }
  }
}
