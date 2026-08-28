"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireUser } from "@/lib/auth"
import { getFacilityTimezone } from "@/lib/facility-timezone"
import { logServerError } from "@/lib/observability/log-server-error"
import { currentUserCan } from "@/lib/permissions/check"
import { createClient } from "@/lib/supabase/server"
import { addDaysToKey, wallTimeToUtc } from "@/lib/timezone"

import type { SimpleResult } from "./_lib/types"

const REQUESTS_PATH = "/reports/rink-scheduling/requests"
const CALENDAR_PATH = "/reports/rink-scheduling"

// ---------------------------------------------------------------------------
// Guard. Deciding requests and working the waitlist are edit-tier acts (the
// same tier the rink_booking_requests / rink_waitlist_entries RLS policies
// enforce). facility_id always comes from the session, never from the client.
// ---------------------------------------------------------------------------

async function requireScheduler(): Promise<
  { ok: true; facilityId: string; employeeId: string | null } | { ok: false; error: string }
> {
  await requireUser()
  const current = await getCurrentUser()
  const profile = current?.profile
  if (!profile?.facility_id) {
    return { ok: false, error: "No facility assigned to your account." }
  }

  const supabase = await createClient()
  if (!(await currentUserCan(supabase, "rink_scheduling", "edit"))) {
    return {
      ok: false,
      error: "This needs the Rink Scheduling edit permission.",
    }
  }

  const { data: employee } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", current!.authUser.id)
    .eq("facility_id", profile.facility_id)
    .eq("is_active", true)
    .maybeSingle()

  return { ok: true, facilityId: profile.facility_id, employeeId: employee?.id ?? null }
}

function caught(e: unknown): { ok: false; error: string } {
  logServerError("reports/rink-scheduling/request-actions", e)
  return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

/** 1050 -> "17:30" (for building a wall-clock string; minute must be < 1440). */
function minuteToHhmm(minute: number): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`
}

/** The rink must exist, be active, and belong to THIS facility — a rink id is
 *  client input on both actions below, so it is verified, never trusted. */
async function rinkBelongsToFacility(
  facilityId: string,
  rinkId: string,
): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("facility_rinks")
    .select("id")
    .eq("id", rinkId)
    .eq("facility_id", facilityId)
    .eq("is_active", true)
    .maybeSingle()
  return Boolean(data)
}

// Best-effort, mirroring actions.ts: a booking write must not fail because the
// coverage debounce row could not be added.
async function enqueueCoverageCheck(facilityId: string): Promise<void> {
  try {
    const supabase = await createClient()
    await supabase
      .from("rink_coverage_reeval_queue")
      .insert({ facility_id: facilityId, reason: "booking_change", status: "pending" })
  } catch {
    // Intentionally swallowed; the sweep also runs on a schedule.
  }
}

// ---------------------------------------------------------------------------
// Approve — creates a TENTATIVE booking from the request, then marks the
// request approved with a back-link. The exclusion constraint is the source
// of truth for conflicts: we attempt the insert and translate 23P01, exactly
// like createBooking in actions.ts. A conflict leaves the request UNDECIDED so
// the approver can pick another rink or handle it by hand.
// ---------------------------------------------------------------------------

export async function approveRequest(
  requestId: string,
  rinkId: string | null,
  note: string | null,
): Promise<{ ok: true; bookingId: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireScheduler()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const supabase = await createClient()
    const { data: request } = await supabase
      .from("rink_booking_requests")
      .select("*")
      .eq("id", requestId)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle()
    if (!request) return { ok: false, error: "Request not found." }
    if (request.status !== "new") {
      return { ok: false, error: "This request has already been decided." }
    }

    // The request's own rink, or the one the approver picked for an
    // "Any rink" request. Either way it must be this facility's.
    const chosenRinkId = rinkId ?? request.rink_id
    if (!chosenRinkId) {
      return { ok: false, error: "Pick a rink to book this request onto." }
    }
    if (!(await rinkBelongsToFacility(ctx.facilityId, chosenRinkId))) {
      return { ok: false, error: "That rink is not one of this facility's active rinks." }
    }

    const [{ data: types }, { data: settings }] = await Promise.all([
      supabase
        .from("rink_booking_types")
        .select("id, slug, is_billable")
        .eq("facility_id", ctx.facilityId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("rink_scheduling_settings")
        .select("default_buffer_minutes")
        .eq("facility_id", ctx.facilityId)
        .maybeSingle(),
    ])

    const bookingType =
      (types ?? []).find((t) => t.slug === "ice-rental") ??
      (types ?? []).find((t) => t.is_billable) ??
      null
    if (!bookingType) {
      return {
        ok: false,
        error: "No billable booking type is configured for this facility.",
      }
    }
    const buffer = settings?.default_buffer_minutes ?? 15

    // Requested minutes -> real instants, in the FACILITY's zone. An end past
    // 1440 is the next facility-local day (the form allows up to 04:00).
    const timeZone = await getFacilityTimezone(supabase, ctx.facilityId)
    const startsAt = wallTimeToUtc(
      `${request.requested_date}T${minuteToHhmm(request.start_minute)}`,
      timeZone,
    )
    const endsAt =
      request.end_minute >= 1440
        ? wallTimeToUtc(
            `${addDaysToKey(request.requested_date, 1)}T${minuteToHhmm(request.end_minute - 1440)}`,
            timeZone,
          )
        : wallTimeToUtc(
            `${request.requested_date}T${minuteToHhmm(request.end_minute)}`,
            timeZone,
          )
    if (!startsAt || !endsAt) {
      return { ok: false, error: "Could not resolve the requested times." }
    }

    const bookingInsert = {
      facility_id: ctx.facilityId,
      rink_id: chosenRinkId,
      customer_id: null as string | null,
      booking_type_id: bookingType.id,
      title: `${request.organization ?? request.requester_name} (requested)`,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      buffer_minutes_after: buffer,
      status: "tentative",
      // No rate snapshot: this is an unpriced hold. The scheduler prices it
      // when they confirm/edit the booking; NULL renders as "—", not $0.
      notes:
        `Requested by ${request.requester_name} <${request.requester_email}>` +
        (request.purpose ? `\n\n${request.purpose}` : ""),
      created_by: ctx.employeeId,
      // blocks_until is trigger-maintained; never sent from here.
    }

    let { data: booking, error } = await supabase
      .from("rink_bookings")
      .insert(bookingInsert)
      .select("id")
      .maybeSingle()

    if (error?.code === "23514") {
      // The rink_bookings_require_customer trigger (migration 247) refuses a
      // customer-less booking of a billable type. Approving means the desk
      // accepted this requester, so attach them as a customer: reuse an
      // existing active customer with the same name, or create one.
      const customerId = await ensureRequestCustomer(
        ctx.facilityId,
        request.organization ?? request.requester_name,
      )
      if (!customerId) {
        return {
          ok: false,
          error:
            "Could not create a customer record for this requester, and the booking type requires one.",
        }
      }
      ;({ data: booking, error } = await supabase
        .from("rink_bookings")
        .insert({ ...bookingInsert, customer_id: customerId })
        .select("id")
        .maybeSingle())
    }

    if (error) {
      if (error.code === "23P01") {
        // Request stays 'new' on purpose — a conflict is not a decision.
        return {
          ok: false,
          error:
            "That slot conflicts with an existing booking on this rink (resurfacing buffer included). Pick another rink, or handle it from the calendar — the request has not been decided.",
        }
      }
      return { ok: false, error: error.message || "Failed to create the booking." }
    }
    if (!booking) return { ok: false, error: "Failed to create the booking." }

    // Decide the request, guarding on status = 'new' so a concurrent decision
    // cannot be silently overwritten. Losing that race rolls our booking back.
    const { data: decided, error: decideError } = await supabase
      .from("rink_booking_requests")
      .update({
        status: "approved",
        decided_by: ctx.employeeId,
        decided_at: new Date().toISOString(),
        decision_note: note?.trim() || null,
        created_booking_id: booking.id,
      })
      .eq("id", requestId)
      .eq("facility_id", ctx.facilityId)
      .eq("status", "new")
      .select("id")
    if (decideError || (decided ?? []).length === 0) {
      await supabase
        .from("rink_bookings")
        .delete()
        .eq("id", booking.id)
        .eq("facility_id", ctx.facilityId)
      return {
        ok: false,
        error:
          decideError?.message ??
          "Someone else decided this request just now. Reload to see the outcome.",
      }
    }

    await enqueueCoverageCheck(ctx.facilityId)
    revalidatePath(REQUESTS_PATH)
    revalidatePath(CALENDAR_PATH)
    return { ok: true, bookingId: booking.id }
  } catch (e) {
    return caught(e)
  }
}

/** Reuse an active customer with this exact name, or create one. */
async function ensureRequestCustomer(
  facilityId: string,
  name: string,
): Promise<string | null> {
  const supabase = await createClient()
  const { data: existing } = await supabase
    .from("rink_customers")
    .select("id")
    .eq("facility_id", facilityId)
    .eq("name", name)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()
  if (existing) return existing.id

  const { data: created } = await supabase
    .from("rink_customers")
    .insert({ facility_id: facilityId, name, is_active: true })
    .select("id")
    .maybeSingle()
  return created?.id ?? null
}

// ---------------------------------------------------------------------------
// Decline / archive
// ---------------------------------------------------------------------------

export async function declineRequest(
  requestId: string,
  note: string | null,
): Promise<SimpleResult> {
  try {
    const ctx = await requireScheduler()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const supabase = await createClient()
    const { data: decided, error } = await supabase
      .from("rink_booking_requests")
      .update({
        status: "declined",
        decided_by: ctx.employeeId,
        decided_at: new Date().toISOString(),
        decision_note: note?.trim() || null,
      })
      .eq("id", requestId)
      .eq("facility_id", ctx.facilityId)
      .eq("status", "new")
      .select("id")
    if (error) {
      return { ok: false, error: error.message || "Failed to decline the request." }
    }
    if ((decided ?? []).length === 0) {
      return { ok: false, error: "Request not found, or it was already decided." }
    }

    revalidatePath(REQUESTS_PATH)
    return { ok: true }
  } catch (e) {
    return caught(e)
  }
}

export async function archiveRequest(requestId: string): Promise<SimpleResult> {
  try {
    const ctx = await requireScheduler()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const supabase = await createClient()
    const { data: archived, error } = await supabase
      .from("rink_booking_requests")
      .update({ status: "archived" })
      .eq("id", requestId)
      .eq("facility_id", ctx.facilityId)
      .in("status", ["approved", "declined"])
      .select("id")
    if (error) {
      return { ok: false, error: error.message || "Failed to archive the request." }
    }
    if ((archived ?? []).length === 0) {
      return { ok: false, error: "Only a decided request can be archived." }
    }

    revalidatePath(REQUESTS_PATH)
    return { ok: true }
  } catch (e) {
    return caught(e)
  }
}

// ---------------------------------------------------------------------------
// Waitlist
// ---------------------------------------------------------------------------

export async function addWaitlistEntry(input: {
  customerId: string | null
  contactName: string | null
  contactPhone: string | null
  rinkId: string | null
  desiredDate: string
  startMinute: number | null
  endMinute: number | null
  notes: string | null
}): Promise<SimpleResult> {
  try {
    const ctx = await requireScheduler()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const contactName = input.contactName?.trim() || null
    const contactPhone = input.contactPhone?.trim() || null
    const notes = input.notes?.trim() || null
    const customerId = input.customerId || null

    // The DB CHECK requires someone to call: an existing customer OR a name.
    if (!customerId && !contactName) {
      return { ok: false, error: "Pick a customer or enter a contact name." }
    }
    if (contactName && contactName.length > 120) {
      return { ok: false, error: "Contact name must be 120 characters or fewer." }
    }
    if (contactPhone && contactPhone.length > 40) {
      return { ok: false, error: "Phone must be 40 characters or fewer." }
    }
    if (notes && notes.length > 2000) {
      return { ok: false, error: "Notes must be 2000 characters or fewer." }
    }
    if (!DAY_KEY.test(input.desiredDate)) {
      return { ok: false, error: "Pick a date." }
    }

    // The window is optional, but it is a PAIR: both ends or neither.
    const start = input.startMinute
    const end = input.endMinute
    if ((start === null) !== (end === null)) {
      return { ok: false, error: "Enter both a start and an end time, or leave both blank." }
    }
    if (start !== null && end !== null) {
      if (
        !Number.isInteger(start) || start < 0 || start >= 1440 ||
        !Number.isInteger(end) || end <= start || end > 1680
      ) {
        return { ok: false, error: "The end time must be after the start time." }
      }
    }

    const supabase = await createClient()

    if (customerId) {
      const { data: customer } = await supabase
        .from("rink_customers")
        .select("id")
        .eq("id", customerId)
        .eq("facility_id", ctx.facilityId)
        .maybeSingle()
      if (!customer) return { ok: false, error: "That customer was not found." }
    }
    if (input.rinkId && !(await rinkBelongsToFacility(ctx.facilityId, input.rinkId))) {
      return { ok: false, error: "That rink is not one of this facility's active rinks." }
    }

    const { error } = await supabase.from("rink_waitlist_entries").insert({
      facility_id: ctx.facilityId,
      customer_id: customerId,
      contact_name: contactName,
      contact_phone: contactPhone,
      rink_id: input.rinkId || null,
      desired_date: input.desiredDate,
      start_minute: start,
      end_minute: end,
      notes,
      status: "open",
      created_by: ctx.employeeId,
    })
    if (error) {
      return { ok: false, error: error.message || "Failed to add the waitlist entry." }
    }

    revalidatePath(REQUESTS_PATH)
    return { ok: true }
  } catch (e) {
    return caught(e)
  }
}

export async function resolveWaitlistEntry(
  entryId: string,
  status: "fulfilled" | "cancelled",
): Promise<SimpleResult> {
  try {
    const ctx = await requireScheduler()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    if (status !== "fulfilled" && status !== "cancelled") {
      return { ok: false, error: "Unknown waitlist outcome." }
    }

    const supabase = await createClient()
    const { data: resolved, error } = await supabase
      .from("rink_waitlist_entries")
      .update({ status, resolved_at: new Date().toISOString() })
      .eq("id", entryId)
      .eq("facility_id", ctx.facilityId)
      .eq("status", "open")
      .select("id")
    if (error) {
      return { ok: false, error: error.message || "Failed to update the waitlist entry." }
    }
    if ((resolved ?? []).length === 0) {
      return { ok: false, error: "That entry was not found, or it is already resolved." }
    }

    revalidatePath(REQUESTS_PATH)
    return { ok: true }
  } catch (e) {
    return caught(e)
  }
}
