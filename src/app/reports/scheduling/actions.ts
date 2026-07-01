"use server"

import { revalidatePath } from "next/cache"

import { requireUser } from "@/lib/auth"
import { currentUserCan } from "@/lib/permissions/check"
import { createClient } from "@/lib/supabase/server"
import { wallTimeToUtc } from "@/lib/timezone"

import {
  INITIAL_ACTION_STATE,
  type ActionState,
  type AvailabilityType,
} from "./types"

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  // Exclusion-constraint backstop (migration 140): an assignment that would
  // double-book the employee. Surface the same friendly copy as the app-side
  // 'double_booked' pre-validation (formatViolations(["double_booked"])).
  if (err.code === "23P01") {
    return "This assignment overlaps another shift this employee is already on."
  }
  // Map RLS / permission errors to friendly text.
  const msg = err.message?.trim() ?? ""
  if (
    msg.toLowerCase().includes("row-level security") ||
    msg.toLowerCase().includes("permission denied") ||
    err.code === "42501"
  ) {
    return "You don't have permission to do that."
  }
  return msg.length > 0 ? msg : fallback
}

async function getActiveEmployee(): Promise<
  | { ok: true; employee: { id: string; facility_id: string } }
  | { ok: false; error: string }
> {
  const current = await requireUser()
  const supabase = await createClient()
  const { data: row, error } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()
  if (error) {
    return { ok: false, error: dbError(error, "Failed to load your account.") }
  }
  if (!row) {
    return {
      ok: false,
      error: "Your account isn't fully set up. Contact your administrator.",
    }
  }
  return { ok: true, employee: { id: row.id, facility_id: row.facility_id } }
}

async function facilityTimezone(facilityId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("facilities")
    .select("timezone")
    .eq("id", facilityId)
    .maybeSingle<{ timezone: string | null }>()
  return data?.timezone ?? null
}

function parseTime(raw: string): string | null {
  // Accept HH:MM or HH:MM:SS
  if (!raw) return null
  const m = raw.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  const h = Number(m[1])
  const mm = Number(m[2])
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null
  return `${m[1]}:${m[2]}:${m[3] ?? "00"}`
}

const VALID_AVAILABILITY_TYPES: AvailabilityType[] = [
  "available",
  "unavailable",
  "preferred",
]

function isAvailabilityType(v: string): v is AvailabilityType {
  return (VALID_AVAILABILITY_TYPES as string[]).includes(v)
}

export async function submitTimeOffRequest(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const auth = await getActiveEmployee()
  if (!auth.ok) return { status: "error", error: auth.error }
  const supabase = await createClient()

  // Same permission the offline replay endpoint enforces — otherwise the
  // identical submission succeeds online but dead-letters when queued offline.
  if (!(await currentUserCan(supabase, "scheduling", "submit"))) {
    return {
      status: "error",
      error: "You don't have permission to submit time-off requests.",
    }
  }

  // datetime-local strings are wall-clock times in the FACILITY's timezone.
  const tz = await facilityTimezone(auth.employee.facility_id)
  const startsAt = wallTimeToUtc(String(formData.get("starts_at") ?? ""), tz)
  const endsAt = wallTimeToUtc(String(formData.get("ends_at") ?? ""), tz)
  const reasonRaw = String(formData.get("reason") ?? "").trim()

  if (!startsAt || !endsAt) {
    return { status: "error", error: "Pick a start and end date/time." }
  }
  if (endsAt <= startsAt) {
    return { status: "error", error: "End time must be after start time." }
  }

  const { error } = await supabase.from("schedule_time_off_requests").insert({
    facility_id: auth.employee.facility_id,
    employee_id: auth.employee.id,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    reason: reasonRaw.length > 0 ? reasonRaw : null,
    status: "pending",
  })

  if (error) {
    return {
      status: "error",
      error: dbError(error, "Failed to submit time-off request."),
    }
  }

  revalidatePath("/reports/scheduling/time-off")
  revalidatePath("/reports/scheduling")
  return { status: "success", message: "Time-off request submitted." }
}

export async function cancelTimeOffRequest(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const auth = await getActiveEmployee()
  if (!auth.ok) return { status: "error", error: auth.error }
  const supabase = await createClient()

  const id = String(formData.get("id") ?? "").trim()
  if (!id) return { status: "error", error: "Missing request id." }

  const { data: row, error: fetchErr } = await supabase
    .from("schedule_time_off_requests")
    .select("id, status, employee_id")
    .eq("id", id)
    .eq("facility_id", auth.employee.facility_id)
    .maybeSingle()

  if (fetchErr || !row) {
    return {
      status: "error",
      error: dbError(fetchErr, "Request not found."),
    }
  }
  if (row.employee_id !== auth.employee.id) {
    return { status: "error", error: "You can only cancel your own requests." }
  }
  if (row.status !== "pending" && row.status !== "approved") {
    return {
      status: "error",
      error: "This request can no longer be cancelled.",
    }
  }

  // Guard on the current status so a concurrent admin decision can't be
  // silently overwritten between our read and this write.
  const { data: updated, error } = await supabase
    .from("schedule_time_off_requests")
    .update({ status: "cancelled" })
    .eq("id", id)
    .in("status", ["pending", "approved"])
    .select("id")

  if (error) {
    return { status: "error", error: dbError(error, "Failed to cancel.") }
  }
  if (!updated || updated.length === 0) {
    return {
      status: "error",
      error: "This request can no longer be cancelled.",
    }
  }

  revalidatePath("/reports/scheduling/time-off")
  return { status: "success", message: "Request cancelled." }
}

export async function upsertAvailability(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const auth = await getActiveEmployee()
  if (!auth.ok) return { status: "error", error: auth.error }
  const supabase = await createClient()

  // Permission parity with the offline replay endpoint.
  if (!(await currentUserCan(supabase, "scheduling", "submit"))) {
    return {
      status: "error",
      error: "You don't have permission to submit availability.",
    }
  }

  // Respect the facility-level toggle (migration 117).
  const { data: settingsRow } = await supabase
    .from("schedule_settings")
    .select("availability_submission_enabled")
    .eq("facility_id", auth.employee.facility_id)
    .maybeSingle()
  if (settingsRow && settingsRow.availability_submission_enabled === false) {
    return {
      status: "error",
      error: "Availability submission is currently turned off by your facility.",
    }
  }

  const id = String(formData.get("id") ?? "").trim()
  const dayRaw = String(formData.get("day_of_week") ?? "").trim()
  const startTime = parseTime(String(formData.get("start_time") ?? ""))
  const endTime = parseTime(String(formData.get("end_time") ?? ""))
  const typeRaw = String(formData.get("availability_type") ?? "available")
  const effectiveFromRaw = String(formData.get("effective_from") ?? "").trim()
  const effectiveToRaw = String(formData.get("effective_to") ?? "").trim()
  const notesRaw = String(formData.get("notes") ?? "").trim()
  const jobAreaIdRaw = String(formData.get("job_area_id") ?? "").trim()

  const day = Number(dayRaw)
  if (!Number.isInteger(day) || day < 0 || day > 6) {
    return { status: "error", error: "Pick a day of the week." }
  }
  if (!startTime || !endTime) {
    return { status: "error", error: "Enter start and end times." }
  }
  if (endTime <= startTime) {
    return { status: "error", error: "End time must be after start time." }
  }
  if (!isAvailabilityType(typeRaw)) {
    return { status: "error", error: "Pick a valid availability type." }
  }

  // A chosen job area must be one the employee is actually assigned to.
  let jobAreaId: string | null = null
  if (jobAreaIdRaw.length > 0) {
    const { data: assignment } = await supabase
      .from("employee_job_area_assignments")
      .select("job_area_id")
      .eq("employee_id", auth.employee.id)
      .eq("job_area_id", jobAreaIdRaw)
      .maybeSingle()
    if (!assignment) {
      return {
        status: "error",
        error: "Pick a job area you're assigned to.",
      }
    }
    jobAreaId = jobAreaIdRaw
  }

  const payload = {
    facility_id: auth.employee.facility_id,
    employee_id: auth.employee.id,
    day_of_week: day,
    start_time: startTime,
    end_time: endTime,
    availability_type: typeRaw,
    effective_from: effectiveFromRaw.length > 0 ? effectiveFromRaw : null,
    effective_to: effectiveToRaw.length > 0 ? effectiveToRaw : null,
    notes: notesRaw.length > 0 ? notesRaw : null,
    job_area_id: jobAreaId,
  }

  if (id) {
    const { data: row } = await supabase
      .from("schedule_availability")
      .select("id, employee_id")
      .eq("id", id)
      .eq("facility_id", auth.employee.facility_id)
      .maybeSingle()
    if (!row || row.employee_id !== auth.employee.id) {
      return { status: "error", error: "Entry not found." }
    }
    const { error } = await supabase
      .from("schedule_availability")
      .update(payload)
      .eq("id", id)
      .eq("facility_id", auth.employee.facility_id)
    if (error) {
      return {
        status: "error",
        error: dbError(error, "Failed to update availability."),
      }
    }
  } else {
    const { error } = await supabase
      .from("schedule_availability")
      .insert(payload)
    if (error) {
      return {
        status: "error",
        error: dbError(error, "Failed to add availability."),
      }
    }
  }

  revalidatePath("/reports/scheduling/availability")
  return { status: "success", message: "Availability saved." }
}

export async function deleteAvailability(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const auth = await getActiveEmployee()
  if (!auth.ok) return { status: "error", error: auth.error }
  const supabase = await createClient()

  const id = String(formData.get("id") ?? "").trim()
  if (!id) return { status: "error", error: "Missing entry id." }

  const { data: row } = await supabase
    .from("schedule_availability")
    .select("id, employee_id")
    .eq("id", id)
    // Defense-in-depth (D-06): explicit facility scope in addition to RLS +
    // the ownership predicate below.
    .eq("facility_id", auth.employee.facility_id)
    .maybeSingle()
  if (!row || row.employee_id !== auth.employee.id) {
    return { status: "error", error: "Entry not found." }
  }

  const { error } = await supabase
    .from("schedule_availability")
    .delete()
    .eq("id", id)

  if (error) {
    return { status: "error", error: dbError(error, "Failed to delete.") }
  }

  revalidatePath("/reports/scheduling/availability")
  return { status: "success", message: "Availability removed." }
}

export async function submitSwapRequest(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const auth = await getActiveEmployee()
  if (!auth.ok) return { status: "error", error: auth.error }
  const supabase = await createClient()

  const requesterShiftId = String(
    formData.get("requester_shift_id") ?? ""
  ).trim()
  const targetEmployeeId = String(
    formData.get("target_employee_id") ?? ""
  ).trim()
  const targetShiftId = String(formData.get("target_shift_id") ?? "").trim()
  const note = String(formData.get("decision_note") ?? "").trim()

  if (!requesterShiftId) {
    return { status: "error", error: "Pick one of your shifts." }
  }

  // Verify the requester shift is mine.
  const { data: shift, error: shiftErr } = await supabase
    .from("schedule_shifts")
    .select("id, employee_id, facility_id")
    .eq("id", requesterShiftId)
    .maybeSingle()
  if (shiftErr || !shift) {
    return { status: "error", error: "Shift not found." }
  }
  if (shift.employee_id !== auth.employee.id) {
    return { status: "error", error: "That shift isn't yours." }
  }

  // The target ids are client-supplied — verify them before persisting.
  if (targetEmployeeId.length > 0) {
    if (targetEmployeeId === auth.employee.id) {
      return { status: "error", error: "Pick a coworker, not yourself." }
    }
    const { data: targetEmp } = await supabase
      .from("employees")
      .select("id")
      .eq("id", targetEmployeeId)
      .eq("facility_id", auth.employee.facility_id)
      .eq("is_active", true)
      .maybeSingle()
    if (!targetEmp) {
      return {
        status: "error",
        error: "That coworker isn't an active member of your facility.",
      }
    }
  }
  if (targetShiftId.length > 0) {
    if (targetEmployeeId.length === 0) {
      return {
        status: "error",
        error: "Pick the coworker whose shift you want to take.",
      }
    }
    const { data: targetShift } = await supabase
      .from("schedule_shifts")
      .select("id, employee_id, facility_id")
      .eq("id", targetShiftId)
      .eq("facility_id", auth.employee.facility_id)
      .maybeSingle()
    if (!targetShift || targetShift.employee_id !== targetEmployeeId) {
      return {
        status: "error",
        error: "That shift doesn't belong to the chosen coworker.",
      }
    }
  }

  const { data: created, error } = await supabase
    .from("schedule_swap_requests")
    .insert({
      facility_id: auth.employee.facility_id,
      requester_employee_id: auth.employee.id,
      requester_shift_id: requesterShiftId,
      target_employee_id: targetEmployeeId.length > 0 ? targetEmployeeId : null,
      target_shift_id: targetShiftId.length > 0 ? targetShiftId : null,
      decision_note: note.length > 0 ? note : null,
      status: "pending",
    })
    .select("id")
    .single()

  if (error || !created) {
    return {
      status: "error",
      error: dbError(error, "Failed to submit swap request."),
    }
  }

  // Tell the chosen coworker (best-effort; the swap stands either way). The
  // SECURITY DEFINER helper exists because staff can't write notifications
  // directly.
  if (targetEmployeeId.length > 0) {
    await supabase.rpc("scheduling_notify_swap_request", {
      p_swap_id: created.id,
    })
  }

  revalidatePath("/reports/scheduling/swaps")
  return { status: "success", message: "Swap request sent." }
}

export async function cancelSwapRequest(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const auth = await getActiveEmployee()
  if (!auth.ok) return { status: "error", error: auth.error }
  const supabase = await createClient()

  const id = String(formData.get("id") ?? "").trim()
  if (!id) return { status: "error", error: "Missing swap id." }

  const { data: row } = await supabase
    .from("schedule_swap_requests")
    .select("id, status, requester_employee_id")
    .eq("id", id)
    .eq("facility_id", auth.employee.facility_id)
    .maybeSingle()

  if (!row) return { status: "error", error: "Swap not found." }
  if (row.requester_employee_id !== auth.employee.id) {
    return { status: "error", error: "You can only cancel your own swaps." }
  }
  if (
    row.status === "cancelled" ||
    row.status === "manager_approved" ||
    row.status === "denied" ||
    row.status === "expired"
  ) {
    return { status: "error", error: "This swap can no longer be cancelled." }
  }

  // Guard on the current status so a concurrent accept/approve can't be
  // silently overwritten between our read and this write.
  const { data: updated, error } = await supabase
    .from("schedule_swap_requests")
    .update({ status: "cancelled" })
    .eq("id", id)
    .in("status", ["pending", "accepted"])
    .select("id")

  if (error) {
    return { status: "error", error: dbError(error, "Failed to cancel swap.") }
  }
  if (!updated || updated.length === 0) {
    return { status: "error", error: "This swap can no longer be cancelled." }
  }

  revalidatePath("/reports/scheduling/swaps")
  return { status: "success", message: "Swap cancelled." }
}

export async function acceptSwapRequest(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const auth = await getActiveEmployee()
  if (!auth.ok) return { status: "error", error: auth.error }
  const supabase = await createClient()

  const id = String(formData.get("id") ?? "").trim()
  if (!id) return { status: "error", error: "Missing swap id." }

  const { data: row } = await supabase
    .from("schedule_swap_requests")
    .select("id, status, target_employee_id")
    .eq("id", id)
    // Defense-in-depth (D-06): explicit facility scope in addition to RLS +
    // the target-employee ownership check below.
    .eq("facility_id", auth.employee.facility_id)
    .maybeSingle()

  if (!row) return { status: "error", error: "Swap not found." }
  if (row.target_employee_id !== auth.employee.id) {
    return { status: "error", error: "This swap isn't directed at you." }
  }
  if (row.status !== "pending") {
    return { status: "error", error: "Only pending swaps can be accepted." }
  }

  // Guard on `pending` so a cancel that landed after our read can't be
  // flipped back to accepted.
  const { data: updated, error } = await supabase
    .from("schedule_swap_requests")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")

  if (error) {
    return { status: "error", error: dbError(error, "Failed to accept swap.") }
  }
  if (!updated || updated.length === 0) {
    return { status: "error", error: "This swap is no longer pending." }
  }

  revalidatePath("/reports/scheduling/swaps")
  return { status: "success", message: "Swap accepted." }
}

export async function claimOpenShift(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const auth = await getActiveEmployee()
  if (!auth.ok) return { status: "error", error: auth.error }
  const supabase = await createClient()

  const openShiftId = String(formData.get("open_shift_id") ?? "").trim()
  if (!openShiftId) {
    return { status: "error", error: "Missing open shift id." }
  }

  const { data, error } = await supabase.rpc("scheduling_claim_open_shift", {
    p_open_shift_id: openShiftId,
  })

  if (error) {
    return {
      status: "error",
      error: dbError(error, "Failed to claim shift."),
    }
  }
  if (data === false) {
    return {
      status: "error",
      error: "That shift is no longer available.",
    }
  }

  revalidatePath("/reports/scheduling")
  revalidatePath("/reports/scheduling/my-schedule")
  return { status: "success", message: "Shift claim submitted." }
}

export async function markNotificationRead(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const auth = await getActiveEmployee()
  if (!auth.ok) return { status: "error", error: auth.error }
  const supabase = await createClient()

  const id = String(formData.get("id") ?? "").trim()
  if (!id) return { status: "error", error: "Missing notification id." }

  const { error } = await supabase
    .from("schedule_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("employee_id", auth.employee.id)

  if (error) {
    return {
      status: "error",
      error: dbError(error, "Failed to mark as read."),
    }
  }

  revalidatePath("/reports/scheduling/notifications")
  revalidatePath("/reports/scheduling")
  return { status: "success" }
}

export async function markAllNotificationsRead(
  _prev: ActionState,
  _formData: FormData
): Promise<ActionState> {
  void _prev
  void _formData
  const auth = await getActiveEmployee()
  if (!auth.ok) return { status: "error", error: auth.error }
  const supabase = await createClient()

  const { error } = await supabase
    .from("schedule_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("employee_id", auth.employee.id)
    .is("read_at", null)

  if (error) {
    return {
      status: "error",
      error: dbError(error, "Failed to mark all as read."),
    }
  }

  revalidatePath("/reports/scheduling/notifications")
  revalidatePath("/reports/scheduling")
  return { status: "success", message: "All caught up." }
}

export { INITIAL_ACTION_STATE }
