"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireUser } from "@/lib/auth"
import { getFacilityTimezone } from "@/lib/facility-timezone"
import { logServerError } from "@/lib/observability/log-server-error"
import { currentUserCan } from "@/lib/permissions/check"
import { createClient } from "@/lib/supabase/server"
import type { TablesUpdate } from "@/types/database"

import { quoteBooking, type RateQuote } from "./_lib/rate-engine"
import type {
  BookingConflict,
  CreateBookingResult,
  SimpleResult,
} from "./_lib/types"

const CALENDAR_PATH = "/reports/rink-scheduling"

// ---------------------------------------------------------------------------
// Guards. facility_id is derived from the session, never accepted from a form.
// ---------------------------------------------------------------------------

type FacilityCtx = {
  facilityId: string
  employeeId: string | null
  canCreate: boolean
  canEdit: boolean
}

async function resolveContext(): Promise<
  { ok: true; ctx: FacilityCtx } | { ok: false; error: string }
> {
  const current = await getCurrentUser()
  const profile = current?.profile
  if (!profile) return { ok: false, error: "Not signed in." }
  if (!profile.facility_id) {
    return { ok: false, error: "No facility assigned to your account." }
  }

  const supabase = await createClient()
  const [canCreate, canEdit] = await Promise.all([
    currentUserCan(supabase, "rink_scheduling", "submit"),
    currentUserCan(supabase, "rink_scheduling", "edit"),
  ])

  const { data: employee } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", current.authUser.id)
    .eq("facility_id", profile.facility_id)
    .eq("is_active", true)
    .maybeSingle()

  return {
    ok: true,
    ctx: {
      facilityId: profile.facility_id,
      employeeId: employee?.id ?? null,
      // An edit grant implies the ability to create; the reverse is not true.
      canCreate: canCreate || canEdit,
      canEdit,
    },
  }
}

function caught(e: unknown): { ok: false; error: string } {
  logServerError("reports/rink-scheduling/actions", e)
  return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
}

// ---------------------------------------------------------------------------
// Conflict reporting
//
// The exclusion constraint is the source of truth: we attempt the insert and
// translate 23P01, rather than pre-checking and hoping nothing changed in
// between. Only AFTER a rejection do we look up what we collided with, purely
// to render a useful message.
// ---------------------------------------------------------------------------

async function findConflicts(
  facilityId: string,
  rinkId: string,
  startsAt: string,
  blocksUntilIso: string,
  excludeBookingId?: string,
): Promise<BookingConflict[]> {
  const supabase = await createClient()
  let q = supabase
    .from("rink_bookings")
    .select(
      "id, title, starts_at, ends_at, blocks_until, rink_id, customer_id, status",
    )
    .eq("facility_id", facilityId)
    .eq("rink_id", rinkId)
    .neq("status", "cancelled")
    .lt("starts_at", blocksUntilIso)
    .gt("blocks_until", startsAt)
  if (excludeBookingId) q = q.neq("id", excludeBookingId)

  const { data } = await q
  const rows = data ?? []
  if (rows.length === 0) return []

  const [{ data: rinks }, { data: customers }] = await Promise.all([
    supabase.from("facility_rinks").select("id, name").eq("facility_id", facilityId),
    supabase.from("rink_customers").select("id, name").eq("facility_id", facilityId),
  ])
  const rinkName = new Map((rinks ?? []).map((r) => [r.id, r.name]))
  const customerName = new Map((customers ?? []).map((c) => [c.id, c.name]))

  return rows.map((r) => ({
    id: r.id,
    title: r.title ?? "Booking",
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    blocksUntil: r.blocks_until,
    rinkName: rinkName.get(r.rink_id) ?? "Rink",
    customerName: r.customer_id ? (customerName.get(r.customer_id) ?? null) : null,
  }))
}

// ---------------------------------------------------------------------------
// Rate preview — resolved server-side so the browser never has to hold the
// rate cards, and so the number shown is the number that will be saved.
// ---------------------------------------------------------------------------

export async function previewRate(input: {
  startsAt: string
  endsAt: string
  bookingTypeId: string
  customerId: string | null
}): Promise<{ ok: true; quote: RateQuote } | { ok: false; error: string }> {
  try {
    const resolved = await resolveContext()
    if (!resolved.ok) return { ok: false, error: resolved.error }
    const { facilityId } = resolved.ctx

    const supabase = await createClient()
    const timeZone = await getFacilityTimezone(supabase, facilityId)

    const [cardsRes, windowsRes, overridesRes, typeRes, customerRes] =
      await Promise.all([
        supabase.from("rink_rate_cards").select("*").eq("facility_id", facilityId),
        supabase
          .from("rink_rate_card_windows")
          .select("*")
          .eq("facility_id", facilityId),
        supabase
          .from("rink_rate_card_type_overrides")
          .select("*")
          .eq("facility_id", facilityId),
        supabase
          .from("rink_booking_types")
          .select("id, is_billable")
          .eq("facility_id", facilityId)
          .eq("id", input.bookingTypeId)
          .maybeSingle(),
        input.customerId
          ? supabase
              .from("rink_customers")
              .select("default_rate_card_id")
              .eq("facility_id", facilityId)
              .eq("id", input.customerId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ])

    const quote = quoteBooking({
      startsAtMs: new Date(input.startsAt).getTime(),
      endsAtMs: new Date(input.endsAt).getTime(),
      timeZone,
      cards: cardsRes.data ?? [],
      windows: windowsRes.data ?? [],
      overrides: overridesRes.data ?? [],
      bookingTypeId: input.bookingTypeId,
      isBillable: typeRes.data?.is_billable ?? true,
      preferredCardId:
        (customerRes.data as { default_rate_card_id?: string | null } | null)
          ?.default_rate_card_id ?? null,
    })

    return { ok: true, quote }
  } catch (e) {
    return caught(e)
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createBooking(input: {
  rinkId: string
  customerId: string | null
  bookingTypeId: string
  title: string | null
  startsAt: string
  endsAt: string
  status: "tentative" | "confirmed"
  notes: string | null
}): Promise<CreateBookingResult> {
  try {
    await requireUser()
    const resolved = await resolveContext()
    if (!resolved.ok) return { ok: false, error: resolved.error }
    const { facilityId, employeeId, canCreate, canEdit } = resolved.ctx

    if (!canCreate) {
      return {
        ok: false,
        error: "You do not have permission to create bookings.",
      }
    }
    // Confirming is an edit-tier act whether it happens now or later. RLS
    // enforces this too; checking here turns a silent zero-row insert into a
    // sentence.
    if (input.status === "confirmed" && !canEdit) {
      return {
        ok: false,
        error:
          "You can create a tentative booking, but confirming it needs the Rink Scheduling edit permission.",
      }
    }

    if (new Date(input.endsAt).getTime() <= new Date(input.startsAt).getTime()) {
      return { ok: false, error: "The end time must be after the start time." }
    }

    const supabase = await createClient()

    const { data: settings } = await supabase
      .from("rink_scheduling_settings")
      .select("default_buffer_minutes")
      .eq("facility_id", facilityId)
      .maybeSingle()
    const buffer = settings?.default_buffer_minutes ?? 15

    const quote = await previewRate({
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      bookingTypeId: input.bookingTypeId,
      customerId: input.customerId,
    })

    const { data, error } = await supabase
      .from("rink_bookings")
      .insert({
        facility_id: facilityId,
        rink_id: input.rinkId,
        customer_id: input.customerId,
        booking_type_id: input.bookingTypeId,
        title: input.title,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        buffer_minutes_after: buffer,
        status: input.status,
        // Snapshotted now. A later rate-card edit must never restate this.
        rate_snapshot_hourly: quote.ok ? quote.quote.snapshotHourlyRate : null,
        rate_snapshot_prime: quote.ok ? quote.quote.allPrime : null,
        computed_amount: quote.ok ? quote.quote.totalAmount : null,
        notes: input.notes,
        created_by: employeeId,
        // blocks_until is trigger-maintained; never sent from here.
      })
      .select("id")
      .maybeSingle()

    if (error) {
      if (error.code === "23P01") {
        const blocksUntil = new Date(
          new Date(input.endsAt).getTime() + buffer * 60_000,
        ).toISOString()
        const conflicts = await findConflicts(
          facilityId,
          input.rinkId,
          input.startsAt,
          blocksUntil,
        )
        return {
          ok: false,
          error:
            "That slot overlaps an existing booking on this rink, once the resurfacing buffer is counted.",
          conflicts,
        }
      }
      if (error.code === "23514") {
        return {
          ok: false,
          error:
            "A billable booking needs a customer. Pick one, or choose a non-billable booking type.",
        }
      }
      return { ok: false, error: error.message || "Failed to create the booking." }
    }

    if (!data) return { ok: false, error: "Failed to create the booking." }

    await enqueueCoverageCheck(facilityId, "booking_change")
    revalidatePath(CALENDAR_PATH)
    return { ok: true, id: data.id }
  } catch (e) {
    return caught(e)
  }
}

// ---------------------------------------------------------------------------
// Update / cancel — edit tier only.
// ---------------------------------------------------------------------------

export async function updateBooking(input: {
  id: string
  rinkId: string
  customerId: string | null
  bookingTypeId: string
  title: string | null
  startsAt: string
  endsAt: string
  status: "tentative" | "confirmed"
  notes: string | null
}): Promise<CreateBookingResult> {
  try {
    await requireUser()
    const resolved = await resolveContext()
    if (!resolved.ok) return { ok: false, error: resolved.error }
    const { facilityId, canEdit } = resolved.ctx

    if (!canEdit) {
      return {
        ok: false,
        error: "Editing a booking needs the Rink Scheduling edit permission.",
      }
    }
    if (new Date(input.endsAt).getTime() <= new Date(input.startsAt).getTime()) {
      return { ok: false, error: "The end time must be after the start time." }
    }

    const supabase = await createClient()

    const { data: existing } = await supabase
      .from("rink_bookings")
      .select("buffer_minutes_after, starts_at, ends_at")
      .eq("id", input.id)
      .eq("facility_id", facilityId)
      .maybeSingle()
    if (!existing) return { ok: false, error: "Booking not found." }

    // Re-price only when the window, type or customer actually moved, so an
    // edit to the title alone cannot silently re-rate a booking against a card
    // that changed since it was made.
    const windowMoved =
      existing.starts_at !== input.startsAt || existing.ends_at !== input.endsAt

    const patch: TablesUpdate<"rink_bookings"> = {
      rink_id: input.rinkId,
      customer_id: input.customerId,
      booking_type_id: input.bookingTypeId,
      title: input.title,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      status: input.status,
      notes: input.notes,
    }

    if (windowMoved) {
      const quote = await previewRate({
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        bookingTypeId: input.bookingTypeId,
        customerId: input.customerId,
      })
      if (quote.ok) {
        patch.rate_snapshot_hourly = quote.quote.snapshotHourlyRate
        patch.rate_snapshot_prime = quote.quote.allPrime
        patch.computed_amount = quote.quote.totalAmount
      }
    }

    const { error } = await supabase
      .from("rink_bookings")
      .update(patch)
      .eq("id", input.id)
      .eq("facility_id", facilityId)

    if (error) {
      if (error.code === "23P01") {
        const buffer = existing.buffer_minutes_after ?? 0
        const blocksUntil = new Date(
          new Date(input.endsAt).getTime() + buffer * 60_000,
        ).toISOString()
        const conflicts = await findConflicts(
          facilityId,
          input.rinkId,
          input.startsAt,
          blocksUntil,
          input.id,
        )
        return {
          ok: false,
          error:
            "Those times overlap another booking on this rink, once the resurfacing buffer is counted.",
          conflicts,
        }
      }
      return { ok: false, error: error.message || "Failed to update the booking." }
    }

    await enqueueCoverageCheck(facilityId, "booking_change")
    revalidatePath(CALENDAR_PATH)
    return { ok: true, id: input.id }
  } catch (e) {
    return caught(e)
  }
}

export async function cancelBooking(
  id: string,
  reason: string,
): Promise<SimpleResult> {
  try {
    await requireUser()
    const resolved = await resolveContext()
    if (!resolved.ok) return { ok: false, error: resolved.error }
    const { facilityId, employeeId, canEdit } = resolved.ctx

    if (!canEdit) {
      return {
        ok: false,
        error: "Cancelling a booking needs the Rink Scheduling edit permission.",
      }
    }
    const trimmed = reason.trim()
    if (!trimmed) {
      return { ok: false, error: "Give a reason for the cancellation." }
    }

    const supabase = await createClient()
    const { error } = await supabase
      .from("rink_bookings")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: employeeId,
        cancellation_reason: trimmed,
      })
      .eq("id", id)
      .eq("facility_id", facilityId)
    if (error) {
      return { ok: false, error: error.message || "Failed to cancel the booking." }
    }

    await enqueueCoverageCheck(facilityId, "booking_change")
    revalidatePath(CALENDAR_PATH)
    return { ok: true }
  } catch (e) {
    return caught(e)
  }
}

// ---------------------------------------------------------------------------
// Quick-create a customer from the booking sheet (edit tier).
// ---------------------------------------------------------------------------

export async function quickCreateCustomer(
  name: string,
): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  try {
    await requireUser()
    const resolved = await resolveContext()
    if (!resolved.ok) return { ok: false, error: resolved.error }
    const { facilityId, canEdit } = resolved.ctx

    if (!canEdit) {
      return {
        ok: false,
        error: "Adding a customer needs the Rink Scheduling edit permission.",
      }
    }
    const trimmed = name.trim()
    if (!trimmed) return { ok: false, error: "Enter a customer name." }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("rink_customers")
      .insert({ facility_id: facilityId, name: trimmed, is_active: true })
      .select("id, name")
      .maybeSingle()
    if (error || !data) {
      return { ok: false, error: error?.message ?? "Failed to add the customer." }
    }

    revalidatePath(CALENDAR_PATH)
    return { ok: true, id: data.id, name: data.name }
  } catch (e) {
    return caught(e)
  }
}

// ---------------------------------------------------------------------------
// Coverage queue
//
// Best-effort: a booking write must not fail because the debounce row could
// not be added. The partial unique index means a second pending row for the
// same facility is simply rejected, which is the debounce working.
// ---------------------------------------------------------------------------

async function enqueueCoverageCheck(
  facilityId: string,
  reason: "booking_change" | "hours_change" | "settings_change" | "manual",
): Promise<void> {
  try {
    const supabase = await createClient()
    await supabase
      .from("rink_coverage_reeval_queue")
      .insert({ facility_id: facilityId, reason, status: "pending" })
  } catch {
    // Intentionally swallowed; the sweep also runs on a schedule.
  }
}
