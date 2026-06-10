"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import type { ActionState } from "./types"

// ---------------------------------------------------------------------------
// Shared admin context
// ---------------------------------------------------------------------------

type AdminCtx =
  | { ok: true; facilityId: string; employeeId: string }
  | { ok: false; error: string }

async function resolveAdminContext(): Promise<AdminCtx> {
  await requireAdmin()
  const current = await getCurrentUser()
  const profile = current?.profile
  if (!profile) return { ok: false, error: "Not signed in." }
  const facilityId = profile.facility_id ?? null
  if (!facilityId) {
    return { ok: false, error: "No facility assigned to your account." }
  }
  const supabase = await createClient()
  const { data: emp } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", profile.id)
    .eq("facility_id", facilityId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{ id: string }>()
  if (!emp?.id) {
    return { ok: false, error: "No active employee record for your account." }
  }
  return { ok: true, facilityId, employeeId: emp.id }
}

// ---------------------------------------------------------------------------
// 1. Request: create a pending publish request
// ---------------------------------------------------------------------------

export async function requestSchedulePublish(
  startsAt: string,
  endsAt: string,
  notes?: string,
): Promise<ActionState> {
  const ctx = await resolveAdminContext()
  if (!ctx.ok) return { ok: false, error: ctx.error }
  if (!startsAt || !endsAt) {
    return { ok: false, error: "Range required." }
  }
  if (new Date(endsAt) <= new Date(startsAt)) {
    return { ok: false, error: "End must be after start." }
  }

  const supabase = await createClient()

  // Quick sanity check: are there any drafts in the window? Refuse to file a
  // request for an empty window so reviewers don't waste a click.
  const { count: draftCount } = await supabase
    .from("schedule_shifts")
    .select("id", { count: "exact", head: true })
    .eq("facility_id", ctx.facilityId)
    .eq("status", "draft")
    .gte("starts_at", startsAt)
    .lt("starts_at", endsAt)

  if (!draftCount) {
    return { ok: false, error: "No draft shifts in range." }
  }

  const { error } = await supabase.from("schedule_publish_requests").insert({
    facility_id: ctx.facilityId,
    requested_by_employee_id: ctx.employeeId,
    range_starts_at: startsAt,
    range_ends_at: endsAt,
    notes: notes?.trim() || null,
  })

  if (error) {
    return {
      ok: false,
      error: error.message ?? "Failed to file publish request.",
    }
  }

  revalidatePath("/admin/scheduling/publish")
  revalidatePath("/admin/scheduling/publish/requests")
  return {
    ok: true,
    message: `Publish request filed for ${draftCount} draft shift${draftCount === 1 ? "" : "s"}. Awaiting approval from another admin.`,
  }
}

// ---------------------------------------------------------------------------
// 2. Approve & publish: enforces requester != approver
// ---------------------------------------------------------------------------

type ApprovePublishRpcResult = {
  ok?: boolean
  error?: string
  shift_count?: number
  open_count?: number
}

export async function approveAndPublishRequest(
  requestId: string,
): Promise<ActionState> {
  const ctx = await resolveAdminContext()
  if (!ctx.ok) return { ok: false, error: ctx.error }
  if (!requestId) return { ok: false, error: "Request id required." }

  // One transaction in the database: locks the request (two concurrent
  // approvers can no longer both publish), re-validates every assigned draft
  // against scheduling_assignment_violations, publishes, writes the audit
  // event, opens claim listings for unassigned shifts, notifies (honoring
  // schedule_settings.notify_on_publish), and finalizes the request.
  const supabase = await createClient()
  const { data, error } = await supabase.rpc(
    "scheduling_approve_publish_request",
    { p_request_id: requestId },
  )
  if (error) return { ok: false, error: error.message }

  const result = (data ?? {}) as ApprovePublishRpcResult
  if (result.ok !== true) {
    return { ok: false, error: result.error ?? "Failed to publish." }
  }
  const count = result.shift_count ?? 0
  const openCount = result.open_count ?? 0

  // Best-effort facility-wide alert; the publish itself already committed.
  await supabase.from("communication_alerts").insert({
    facility_id: ctx.facilityId,
    source_module: "scheduling",
    severity: "info",
    title: "Schedule published",
    body: `${count} shift${count === 1 ? "" : "s"} published.`,
    created_by_employee_id: ctx.employeeId,
  })

  revalidatePath("/admin/scheduling")
  revalidatePath("/admin/scheduling/shifts")
  revalidatePath("/admin/scheduling/publish")
  revalidatePath("/admin/scheduling/publish/requests")
  return {
    ok: true,
    message: `Approved. ${count} shift${count === 1 ? "" : "s"} published${
      openCount > 0
        ? `; ${openCount} unassigned shift${openCount === 1 ? "" : "s"} opened for claims`
        : ""
    }.`,
  }
}

// ---------------------------------------------------------------------------
// 3. Reject: also enforces requester != rejecter
// ---------------------------------------------------------------------------

export async function rejectPublishRequest(
  requestId: string,
  reason: string,
): Promise<ActionState> {
  const ctx = await resolveAdminContext()
  if (!ctx.ok) return { ok: false, error: ctx.error }
  if (!requestId) return { ok: false, error: "Request id required." }
  const trimmed = reason?.trim() ?? ""
  if (trimmed.length === 0) {
    return { ok: false, error: "Provide a reason for the rejection." }
  }

  const supabase = await createClient()

  const { data: reqRaw, error: reqErr } = await supabase
    .from("schedule_publish_requests")
    .select("id, facility_id, requested_by_employee_id, status")
    .eq("id", requestId)
    .maybeSingle()

  if (reqErr) return { ok: false, error: reqErr.message }
  const request = reqRaw as {
    id: string
    facility_id: string
    requested_by_employee_id: string
    status: string
  } | null

  if (!request) return { ok: false, error: "Request not found." }
  if (request.status !== "pending") {
    return { ok: false, error: `Request is already ${request.status}.` }
  }
  if (request.facility_id !== ctx.facilityId) {
    return { ok: false, error: "Request belongs to a different facility." }
  }
  if (request.requested_by_employee_id === ctx.employeeId) {
    return { ok: false, error: "You cannot reject your own publish request." }
  }

  const { error } = await supabase
    .from("schedule_publish_requests")
    .update({
      status: "rejected",
      decided_by_employee_id: ctx.employeeId,
      decided_at: new Date().toISOString(),
      rejection_reason: trimmed,
    })
    .eq("id", requestId)
    .eq("status", "pending")

  if (error) return { ok: false, error: error.message }

  revalidatePath("/admin/scheduling/publish")
  revalidatePath("/admin/scheduling/publish/requests")
  return { ok: true, message: "Request rejected." }
}
