"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { checkAssignmentViolations } from "./enforcement"
import type { ActionState } from "./types"

// New schedule_shifts.job_area_id + the violations RPC aren't in the generated
// DB types yet (see CLAUDE.md); cast through `any` at those sites.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any

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

type PendingRequestRow = {
  id: string
  facility_id: string
  requested_by_employee_id: string
  range_starts_at: string
  range_ends_at: string
  status: "pending" | "rejected" | "published"
}

export async function approveAndPublishRequest(
  requestId: string,
): Promise<ActionState> {
  const ctx = await resolveAdminContext()
  if (!ctx.ok) return { ok: false, error: ctx.error }
  if (!requestId) return { ok: false, error: "Request id required." }

  const supabase = (await createClient()) as AnySupabase

  const { data: reqRaw, error: reqErr } = await supabase
    .from("schedule_publish_requests")
    .select(
      "id, facility_id, requested_by_employee_id, range_starts_at, range_ends_at, status",
    )
    .eq("id", requestId)
    .maybeSingle()

  if (reqErr) return { ok: false, error: reqErr.message }
  const request = reqRaw as PendingRequestRow | null
  if (!request) return { ok: false, error: "Request not found." }
  if (request.status !== "pending") {
    return { ok: false, error: `Request is already ${request.status}.` }
  }
  if (request.facility_id !== ctx.facilityId) {
    return { ok: false, error: "Request belongs to a different facility." }
  }
  if (request.requested_by_employee_id === ctx.employeeId) {
    return {
      ok: false,
      error: "You cannot approve your own publish request.",
    }
  }

  // -- publish side effects (mirror publishShiftsInRange) --
  const { data: draftsRaw, error: selErr } = await supabase
    .from("schedule_shifts")
    .select("id, employee_id, starts_at, ends_at, break_minutes, job_area_id")
    .eq("facility_id", ctx.facilityId)
    .eq("status", "draft")
    .gte("starts_at", request.range_starts_at)
    .lt("starts_at", request.range_ends_at)

  if (selErr) return { ok: false, error: selErr.message }
  const drafts = (draftsRaw ?? []) as Array<{
    id: string
    employee_id: string | null
    starts_at: string
    ends_at: string
    break_minutes: number | null
    job_area_id: string | null
  }>
  if (drafts.length === 0) {
    return {
      ok: false,
      error: "No draft shifts remain in range. Reject this request instead.",
    }
  }

  // Hard block: re-validate every assigned draft before publishing. A shift may
  // have become non-compliant (new time-off, availability, etc.) since it was
  // drafted; publishing such a schedule is refused.
  let blockedCount = 0
  for (const d of drafts) {
    if (!d.employee_id) continue
    const codes = await checkAssignmentViolations(supabase, {
      facilityId: ctx.facilityId,
      employeeId: d.employee_id,
      startsAt: d.starts_at,
      endsAt: d.ends_at,
      breakMinutes: d.break_minutes,
      jobAreaId: d.job_area_id,
      excludeShiftId: d.id,
    })
    if (codes.length > 0) blockedCount += 1
  }
  if (blockedCount > 0) {
    return {
      ok: false,
      error: `Cannot publish: ${blockedCount} assigned shift${blockedCount === 1 ? "" : "s"} in this range now violate a scheduling rule. Resolve them (reassign, adjust time-off/availability, or fix the shift) and try again.`,
    }
  }

  const ids = drafts.map((d) => d.id)
  const nowIso = new Date().toISOString()

  const { error: updErr } = await supabase
    .from("schedule_shifts")
    .update({
      status: "published",
      published_at: nowIso,
      published_by_employee_id: ctx.employeeId,
    })
    .in("id", ids)
    .eq("facility_id", ctx.facilityId)

  if (updErr) return { ok: false, error: updErr.message }

  const { data: eventRow, error: eventErr } = await supabase
    .from("schedule_publish_events")
    .insert({
      facility_id: ctx.facilityId,
      published_by_employee_id: ctx.employeeId,
      range_starts_at: request.range_starts_at,
      range_ends_at: request.range_ends_at,
      shift_count: drafts.length,
    })
    .select("id")
    .maybeSingle()

  if (eventErr) {
    // Shifts were already moved; surface the error but don't roll back.
    return {
      ok: false,
      error: `Shifts published but event log failed: ${eventErr.message}`,
    }
  }

  // Per-employee notifications.
  const recipients = drafts
    .filter(
      (d): d is (typeof drafts)[number] & { employee_id: string } =>
        d.employee_id !== null,
    )
    .map((d) => ({
      facility_id: ctx.facilityId,
      employee_id: d.employee_id,
      notification_type: "schedule_published" as const,
      shift_id: d.id,
      payload: {
        range_starts_at: request.range_starts_at,
        range_ends_at: request.range_ends_at,
      },
    }))
  if (recipients.length > 0) {
    await supabase.from("schedule_notifications").insert(recipients)
  }

  await supabase.from("communication_alerts").insert({
    facility_id: ctx.facilityId,
    source_module: "scheduling",
    severity: "info",
    title: "Schedule published",
    body: `${drafts.length} shift${drafts.length === 1 ? "" : "s"} published.`,
    created_by_employee_id: ctx.employeeId,
  })

  // Finalize request row.
  const { error: finErr } = await supabase
    .from("schedule_publish_requests")
    .update({
      status: "published",
      decided_by_employee_id: ctx.employeeId,
      decided_at: nowIso,
      published_event_id: eventRow?.id ?? null,
    })
    .eq("id", requestId)
    .eq("status", "pending")

  if (finErr) return { ok: false, error: finErr.message }

  revalidatePath("/admin/scheduling")
  revalidatePath("/admin/scheduling/shifts")
  revalidatePath("/admin/scheduling/publish")
  revalidatePath("/admin/scheduling/publish/requests")
  return {
    ok: true,
    message: `Approved. ${drafts.length} shift${drafts.length === 1 ? "" : "s"} published.`,
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
