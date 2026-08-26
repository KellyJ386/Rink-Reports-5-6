"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser } from "@/lib/auth"
import { logServerError } from "@/lib/observability/log-server-error"
import { currentUserCan } from "@/lib/permissions/check"
import {
  deriveOccupancyWindow,
  findRoomOverlaps,
  type AssignmentWindow,
} from "@/lib/rink-scheduling/locker-display"
import { createClient } from "@/lib/supabase/server"

import type { SimpleResult } from "./_lib/types"

const CALENDAR_PATH = "/reports/rink-scheduling"

// ---------------------------------------------------------------------------
// Locker room assignments.
//
// Like every other action in this module, facility_id is read from the session
// and written server-side; the client sends a booking id and a room id and
// nothing else that could reach a different tenant. Both ids are re-checked
// against the caller's facility before the write, so a forged id fails here as
// well as at the RLS policy.
//
// Overlapping holds on one room are ALLOWED (fast turnover is normal — see the
// table comment on rink_locker_room_assignments), so the overlap check runs
// for its warnings only and never blocks the write.
// ---------------------------------------------------------------------------

type LockerCtx = {
  facilityId: string
  employeeId: string | null
  leadMinutes: number
  vacateMinutes: number
}

async function resolveLockerContext(): Promise<
  { ok: true; ctx: LockerCtx } | { ok: false; error: string }
> {
  const current = await getCurrentUser()
  const profile = current?.profile
  if (!profile) return { ok: false, error: "Not signed in." }
  if (!profile.facility_id) {
    return { ok: false, error: "No facility assigned to your account." }
  }

  const supabase = await createClient()
  const [canSubmit, canEdit] = await Promise.all([
    currentUserCan(supabase, "rink_scheduling", "submit"),
    currentUserCan(supabase, "rink_scheduling", "edit"),
  ])
  if (!canSubmit && !canEdit) {
    return { ok: false, error: "You do not have permission to assign locker rooms." }
  }

  const [{ data: settings }, { data: employee }] = await Promise.all([
    supabase
      .from("rink_scheduling_settings")
      .select("locker_lead_minutes, locker_vacate_minutes")
      .eq("facility_id", profile.facility_id)
      .maybeSingle(),
    supabase
      .from("employees")
      .select("id")
      .eq("user_id", current.authUser.id)
      .eq("facility_id", profile.facility_id)
      .eq("is_active", true)
      .maybeSingle(),
  ])

  return {
    ok: true,
    ctx: {
      facilityId: profile.facility_id,
      employeeId: employee?.id ?? null,
      // Defaults mirror the column defaults, so a facility whose settings row
      // has not been created yet still gets sensible padding.
      leadMinutes: settings?.locker_lead_minutes ?? 45,
      vacateMinutes: settings?.locker_vacate_minutes ?? 30,
    },
  }
}

function caught(e: unknown): { ok: false; error: string } {
  logServerError("reports/rink-scheduling/locker-actions", e)
  return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
}

export type AssignLockerResult =
  | { ok: true; warnings: string[] }
  | { ok: false; error: string }

/**
 * Attach a locker room to a booking for the booking's window plus the
 * facility's lead/vacate padding.
 *
 * Succeeds with `warnings` when the room is already held by another booking
 * over part of that window — the caller renders them next to the room; it is
 * information, not a rejection.
 */
export async function assignLockerRoom(
  bookingId: string,
  lockerRoomId: string,
): Promise<AssignLockerResult> {
  try {
    if (!bookingId || !lockerRoomId) {
      return { ok: false, error: "Pick a locker room first." }
    }

    const resolved = await resolveLockerContext()
    if (!resolved.ok) return { ok: false, error: resolved.error }
    const { ctx } = resolved

    const supabase = await createClient()

    // Facility-scoped read: a booking id from another tenant resolves to null
    // here and never reaches the insert.
    const { data: booking, error: bookingError } = await supabase
      .from("rink_bookings")
      .select("id, starts_at, ends_at, status")
      .eq("id", bookingId)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle()
    if (bookingError) {
      return { ok: false, error: "Could not load that booking." }
    }
    if (!booking) return { ok: false, error: "That booking is no longer available." }
    if (booking.status === "cancelled") {
      return { ok: false, error: "This booking is cancelled — assign rooms to a live booking." }
    }

    const { data: room } = await supabase
      .from("facility_locker_rooms")
      .select("id, name, is_active")
      .eq("id", lockerRoomId)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle()
    if (!room) return { ok: false, error: "That locker room is no longer available." }
    if (!room.is_active) {
      return { ok: false, error: `${room.name} is not in service.` }
    }

    const window = deriveOccupancyWindow(
      booking.starts_at,
      booking.ends_at,
      ctx.leadMinutes,
      ctx.vacateMinutes,
    )
    if (!window) {
      return { ok: false, error: "That booking's times could not be read." }
    }

    const { data: inserted, error } = await supabase
      .from("rink_locker_room_assignments")
      .insert({
        facility_id: ctx.facilityId,
        booking_id: bookingId,
        locker_room_id: lockerRoomId,
        occupies_from: window.occupiesFromIso,
        occupies_until: window.occupiesUntilIso,
        created_by: ctx.employeeId,
      })
      .select("id")
      .maybeSingle()
    if (error || !inserted) {
      // rink_locker_assignments_booking_room_uniq
      if (error?.code === "23505") {
        return { ok: false, error: `${room.name} is already on this booking.` }
      }
      return { ok: false, error: "Could not assign that locker room." }
    }

    // The overlap scan runs AFTER the insert, so it must exclude the row we
    // just wrote or every assignment would warn about itself.
    const warnings = await describeOverlaps(ctx.facilityId, lockerRoomId, room.name, {
      id: inserted.id,
      lockerRoomId,
      occupiesFrom: window.occupiesFromIso,
      occupiesUntil: window.occupiesUntilIso,
    })

    revalidatePath(CALENDAR_PATH)
    return { ok: true, warnings }
  } catch (e) {
    return caught(e)
  }
}

/** Adjust one assignment's window or its display label. */
export async function updateLockerAssignment(
  assignmentId: string,
  input: { occupiesFromIso?: string; occupiesUntilIso?: string; labelOverride?: string | null },
): Promise<AssignLockerResult> {
  try {
    if (!assignmentId) return { ok: false, error: "Missing assignment id." }

    const resolved = await resolveLockerContext()
    if (!resolved.ok) return { ok: false, error: resolved.error }
    const { ctx } = resolved

    const supabase = await createClient()
    const { data: existing } = await supabase
      .from("rink_locker_room_assignments")
      .select("id, locker_room_id, occupies_from, occupies_until")
      .eq("id", assignmentId)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle()
    if (!existing) return { ok: false, error: "That assignment no longer exists." }

    const from = input.occupiesFromIso ?? existing.occupies_from
    const until = input.occupiesUntilIso ?? existing.occupies_until
    if (!(Date.parse(until) > Date.parse(from))) {
      return { ok: false, error: "The room must be released after it is taken." }
    }

    const label = input.labelOverride?.trim()
    const { error } = await supabase
      .from("rink_locker_room_assignments")
      .update({
        occupies_from: from,
        occupies_until: until,
        // Empty string clears the override and falls back to the booking title.
        ...(input.labelOverride === undefined ? {} : { display_label_override: label || null }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", assignmentId)
      .eq("facility_id", ctx.facilityId)
    if (error) return { ok: false, error: "Could not update that assignment." }

    const { data: room } = await supabase
      .from("facility_locker_rooms")
      .select("name")
      .eq("id", existing.locker_room_id)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle()

    const warnings = await describeOverlaps(
      ctx.facilityId,
      existing.locker_room_id,
      room?.name ?? "That room",
      {
        id: assignmentId,
        lockerRoomId: existing.locker_room_id,
        occupiesFrom: from,
        occupiesUntil: until,
      },
    )

    revalidatePath(CALENDAR_PATH)
    return { ok: true, warnings }
  } catch (e) {
    return caught(e)
  }
}

/** Release a locker room from a booking. */
export async function removeLockerAssignment(assignmentId: string): Promise<SimpleResult> {
  try {
    if (!assignmentId) return { ok: false, error: "Missing assignment id." }

    const resolved = await resolveLockerContext()
    if (!resolved.ok) return { ok: false, error: resolved.error }

    const supabase = await createClient()
    const { error } = await supabase
      .from("rink_locker_room_assignments")
      .delete()
      .eq("id", assignmentId)
      .eq("facility_id", resolved.ctx.facilityId)
    if (error) return { ok: false, error: "Could not release that locker room." }

    revalidatePath(CALENDAR_PATH)
    return { ok: true }
  } catch (e) {
    return caught(e)
  }
}

/**
 * Human-readable overlap warnings for one room and window.
 *
 * The query is deliberately widened by a day on each side and narrowed by
 * findRoomOverlaps, so the half-open comparison lives in one tested place
 * rather than being re-expressed as PostgREST filters.
 */
async function describeOverlaps(
  facilityId: string,
  lockerRoomId: string,
  roomName: string,
  candidate: AssignmentWindow,
): Promise<string[]> {
  const supabase = await createClient()
  const dayMs = 24 * 60 * 60 * 1000
  const from = new Date(Date.parse(candidate.occupiesFrom) - dayMs).toISOString()
  const until = new Date(Date.parse(candidate.occupiesUntil) + dayMs).toISOString()

  const { data } = await supabase
    .from("rink_locker_room_assignments")
    .select("id, locker_room_id, occupies_from, occupies_until")
    .eq("facility_id", facilityId)
    .eq("locker_room_id", lockerRoomId)
    .gte("occupies_until", from)
    .lte("occupies_from", until)

  const rows: AssignmentWindow[] = (data ?? []).map((r) => ({
    id: r.id,
    lockerRoomId: r.locker_room_id,
    occupiesFrom: r.occupies_from,
    occupiesUntil: r.occupies_until,
  }))

  const hits = findRoomOverlaps(rows, candidate)
  if (hits.length === 0) return []
  return [
    hits.length === 1
      ? `${roomName} is also held by another booking during part of this window.`
      : `${roomName} is also held by ${hits.length} other bookings during part of this window.`,
  ]
}
