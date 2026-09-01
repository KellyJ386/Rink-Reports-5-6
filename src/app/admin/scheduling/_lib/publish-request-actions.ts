"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { dbError } from "@/lib/db-error"
import { createClient } from "@/lib/supabase/server"

import { formatDateOnly } from "./datetime"
import { formatViolations } from "./enforcement"
import { queueSchedulingEmails } from "./notify-email"
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

  // Refuse a second request whose window overlaps a still-pending one. Two
  // admins filing for the same week produced two approvable requests for the
  // same drafts; approving the first left the second pointing at rows that
  // were already published, so the approver saw a confusing empty publish.
  const { data: overlapping } = await supabase
    .from("schedule_publish_requests")
    .select("id")
    .eq("facility_id", ctx.facilityId)
    .eq("status", "pending")
    .lt("range_starts_at", endsAt)
    .gt("range_ends_at", startsAt)
    .limit(1)
  if (overlapping && overlapping.length > 0) {
    return {
      ok: false,
      error:
        "A publish request covering this range is already awaiting approval.",
    }
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
      error: dbError(error, "Could not file the publish request."),
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
  // Advisory violation codes present on published shifts that did NOT block
  // (block_on_violations off) — surfaced so the approver still sees them.
  advisory_warnings?: string[]
  advisory_count?: number
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
  if (error)
    return { ok: false, error: dbError(error, "Could not publish the schedule.") }

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

  // Best-effort email to every employee with a shift in the published range
  // (the RPC already wrote their in-app schedule_published notifications,
  // gated on the same setting). One outbox row per employee sharing the
  // request id as source_record_id, so the drain groups them into a single
  // message with N recipients.
  try {
    const [{ data: settings }, { data: reqRow }, { data: facilityRow }] =
      await Promise.all([
        supabase
          .from("schedule_settings")
          .select("notify_on_publish")
          .eq("facility_id", ctx.facilityId)
          .maybeSingle<{ notify_on_publish: boolean }>(),
        supabase
          .from("schedule_publish_requests")
          .select("range_starts_at, range_ends_at")
          .eq("id", requestId)
          .maybeSingle<{ range_starts_at: string; range_ends_at: string }>(),
        supabase
          .from("facilities")
          .select("timezone")
          .eq("id", ctx.facilityId)
          .maybeSingle<{ timezone: string | null }>(),
      ])
    if ((settings?.notify_on_publish ?? true) && reqRow) {
      const { data: assigned } = await supabase
        .from("schedule_shifts")
        .select("employee_id")
        .eq("facility_id", ctx.facilityId)
        .eq("status", "published")
        .not("employee_id", "is", null)
        .gte("starts_at", reqRow.range_starts_at)
        .lt("starts_at", reqRow.range_ends_at)
      const employeeIds = [
        ...new Set(
          ((assigned ?? []) as { employee_id: string | null }[])
            .map((s) => s.employee_id)
            .filter((x): x is string => !!x)
        ),
      ]
      // The published range is a facility-local week; format it in that zone
      // so the email's dates match the schedule staff actually see.
      const tz = facilityRow?.timezone ?? null
      const range = `${formatDateOnly(reqRow.range_starts_at, tz)} – ${formatDateOnly(reqRow.range_ends_at, tz)}`
      await queueSchedulingEmails(
        employeeIds.map((employeeId) => ({
          facilityId: ctx.facilityId,
          employeeId,
          subject: "New schedule published",
          body: `The schedule for ${range} has been published. You have shifts in this range — open the scheduling app to see them.`,
          sourceRecordId: requestId,
        }))
      )
    }
  } catch {
    // Email is best-effort; the publish already succeeded.
  }

  revalidatePath("/admin/scheduling")
  revalidatePath("/admin/scheduling/shifts")
  revalidatePath("/admin/scheduling/publish")
  revalidatePath("/admin/scheduling/publish/requests")
  const advisory = result.advisory_warnings ?? []
  return {
    ok: true,
    message: `Approved. ${count} shift${count === 1 ? "" : "s"} published${
      openCount > 0
        ? `; ${openCount} unassigned shift${openCount === 1 ? "" : "s"} opened for claims`
        : ""
    }.${advisory.length > 0 ? ` Published with advisory warnings — ${formatViolations(advisory)}` : ""}`,
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

  if (reqErr)
    return { ok: false, error: dbError(reqErr, "Could not load the publish request.") }
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

  if (error)
    return {
      ok: false,
      error: dbError(error, "Could not reject the publish request."),
    }

  revalidatePath("/admin/scheduling/publish")
  revalidatePath("/admin/scheduling/publish/requests")
  return { ok: true, message: "Request rejected." }
}
