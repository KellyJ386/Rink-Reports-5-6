"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireUser } from "@/lib/auth"
import { getFacilityTimezone } from "@/lib/facility-timezone"
import { logServerError } from "@/lib/observability/log-server-error"
import { currentUserCan } from "@/lib/permissions/check"
import { createClient } from "@/lib/supabase/server"
import { addDaysToKey, dayKeyInTz } from "@/lib/timezone"

import { quoteBooking } from "./_lib/rate-engine"
import {
  applyResolution,
  generateOccurrences,
  type Occurrence,
  type OccurrenceResolution,
  type RecurrenceSpec,
} from "./_lib/series"
import type { SimpleResult } from "./_lib/types"

const CALENDAR_PATH = "/reports/rink-scheduling"

// ---------------------------------------------------------------------------
// Shared context. Series management is an edit-tier capability throughout
// ("Manage series" in the RBAC matrix), so there is no submit-only path here.
// ---------------------------------------------------------------------------

async function requireSeriesEditor(): Promise<
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
      error: "Managing recurring series needs the Rink Scheduling edit permission.",
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
  logServerError("reports/rink-scheduling/series-actions", e)
  return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export type OccurrencePreview = Occurrence & {
  /** Populated when an existing booking already occupies the slot. */
  conflictWith: string | null
  /** Priced at generation time against the card effective on THIS date, which
   *  is what makes a series spanning a rate change bill correctly. */
  amount: number | null
  rateCardName: string | null
}

export type SeriesPreview =
  | { ok: true; occurrences: OccurrencePreview[]; conflictCount: number }
  | { ok: false; error: string }

/**
 * Expand the pattern and check every occurrence against the ice already
 * booked, so the user sees the whole picture BEFORE anything is written.
 *
 * The conflict check here is advisory. The database's exclusion constraint
 * remains the authority at commit time — this exists so the user is not
 * surprised, not to replace the guarantee.
 */
export async function previewSeries(input: {
  rinkId: string
  bookingTypeId: string
  customerId: string | null
  recurrence: RecurrenceSpec
}): Promise<SeriesPreview> {
  try {
    const ctx = await requireSeriesEditor()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const supabase = await createClient()
    const timeZone = await getFacilityTimezone(supabase, ctx.facilityId)

    const generated = generateOccurrences(input.recurrence, timeZone)
    if (!generated.ok) return { ok: false, error: generated.error }

    const { data: settings } = await supabase
      .from("rink_scheduling_settings")
      .select("default_buffer_minutes")
      .eq("facility_id", ctx.facilityId)
      .maybeSingle()
    const buffer = settings?.default_buffer_minutes ?? 15

    const first = generated.occurrences[0]
    const last = generated.occurrences[generated.occurrences.length - 1]

    // One bulk read across the whole span rather than a query per occurrence.
    const { data: existing } = await supabase
      .from("rink_bookings")
      .select("id, title, starts_at, blocks_until, customer_id")
      .eq("facility_id", ctx.facilityId)
      .eq("rink_id", input.rinkId)
      .neq("status", "cancelled")
      .lt("starts_at", new Date(new Date(last.endsAt).getTime() + buffer * 60_000).toISOString())
      .gt("blocks_until", first.startsAt)

    const [cardsRes, windowsRes, overridesRes, typeRes, customerRes] =
      await Promise.all([
        supabase.from("rink_rate_cards").select("*").eq("facility_id", ctx.facilityId),
        supabase.from("rink_rate_card_windows").select("*").eq("facility_id", ctx.facilityId),
        supabase
          .from("rink_rate_card_type_overrides")
          .select("*")
          .eq("facility_id", ctx.facilityId),
        supabase
          .from("rink_booking_types")
          .select("is_billable")
          .eq("facility_id", ctx.facilityId)
          .eq("id", input.bookingTypeId)
          .maybeSingle(),
        input.customerId
          ? supabase
              .from("rink_customers")
              .select("default_rate_card_id")
              .eq("facility_id", ctx.facilityId)
              .eq("id", input.customerId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ])

    const isBillable = typeRes.data?.is_billable ?? true
    const preferredCardId =
      (customerRes.data as { default_rate_card_id?: string | null } | null)
        ?.default_rate_card_id ?? null

    const occurrences: OccurrencePreview[] = generated.occurrences.map((o) => {
      const startMs = new Date(o.startsAt).getTime()
      const blockedUntilMs = new Date(o.endsAt).getTime() + buffer * 60_000

      const clash = (existing ?? []).find((b) => {
        const bStart = new Date(b.starts_at).getTime()
        const bBlockEnd = new Date(b.blocks_until).getTime()
        return startMs < bBlockEnd && bStart < blockedUntilMs
      })

      const quote = quoteBooking({
        startsAtMs: startMs,
        endsAtMs: new Date(o.endsAt).getTime(),
        timeZone,
        cards: cardsRes.data ?? [],
        windows: windowsRes.data ?? [],
        overrides: overridesRes.data ?? [],
        bookingTypeId: input.bookingTypeId,
        isBillable,
        preferredCardId,
      })

      return {
        ...o,
        conflictWith: clash ? (clash.title ?? "an existing booking") : null,
        amount: isBillable ? quote.totalAmount : null,
        rateCardName: quote.rateCardName,
      }
    })

    return {
      ok: true,
      occurrences,
      conflictCount: occurrences.filter((o) => o.conflictWith !== null).length,
    }
  } catch (e) {
    return caught(e)
  }
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

export type CreateSeriesResult =
  | { ok: true; seriesId: string; created: number; skipped: number; failed: string[] }
  | { ok: false; error: string }

/**
 * Write the series and its occurrences.
 *
 * Occurrences go in ONE AT A TIME on purpose. A batch insert that trips the
 * exclusion constraint tells us only that something clashed, not which
 * occurrence — and the whole point of this flow is per-occurrence resolution.
 * The row count is capped by the generator, so the loop is bounded.
 *
 * A clash discovered here (someone booked the slot between preview and commit)
 * is reported per date rather than aborting the whole series: the customer's
 * other 30 weeks should not be lost because week 12 was taken.
 */
export async function createSeries(input: {
  rinkId: string
  bookingTypeId: string
  customerId: string | null
  title: string | null
  notes: string | null
  status: "tentative" | "confirmed"
  recurrence: RecurrenceSpec
  resolutions: Record<string, OccurrenceResolution>
}): Promise<CreateSeriesResult> {
  try {
    const ctx = await requireSeriesEditor()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const supabase = await createClient()
    const timeZone = await getFacilityTimezone(supabase, ctx.facilityId)

    const generated = generateOccurrences(input.recurrence, timeZone)
    if (!generated.ok) return { ok: false, error: generated.error }

    const { data: settings } = await supabase
      .from("rink_scheduling_settings")
      .select("default_buffer_minutes")
      .eq("facility_id", ctx.facilityId)
      .maybeSingle()
    const buffer = settings?.default_buffer_minutes ?? 15

    const { data: series, error: seriesError } = await supabase
      .from("rink_booking_series")
      .insert({
        facility_id: ctx.facilityId,
        customer_id: input.customerId,
        rink_id: input.rinkId,
        booking_type_id: input.bookingTypeId,
        title: input.title,
        frequency: "weekly",
        interval_weeks: input.recurrence.intervalWeeks,
        days_of_week: input.recurrence.daysOfWeek,
        start_time: input.recurrence.startTime,
        end_time: input.recurrence.endTime,
        series_start_date: input.recurrence.seriesStartDate,
        series_end_date: input.recurrence.seriesEndDate,
        notes: input.notes,
        status: "active",
        created_by: ctx.employeeId,
      })
      .select("id")
      .maybeSingle()

    if (seriesError || !series) {
      return {
        ok: false,
        error: seriesError?.message ?? "Failed to create the series.",
      }
    }

    const [cardsRes, windowsRes, overridesRes, typeRes, customerRes] =
      await Promise.all([
        supabase.from("rink_rate_cards").select("*").eq("facility_id", ctx.facilityId),
        supabase.from("rink_rate_card_windows").select("*").eq("facility_id", ctx.facilityId),
        supabase
          .from("rink_rate_card_type_overrides")
          .select("*")
          .eq("facility_id", ctx.facilityId),
        supabase
          .from("rink_booking_types")
          .select("is_billable")
          .eq("facility_id", ctx.facilityId)
          .eq("id", input.bookingTypeId)
          .maybeSingle(),
        input.customerId
          ? supabase
              .from("rink_customers")
              .select("default_rate_card_id")
              .eq("facility_id", ctx.facilityId)
              .eq("id", input.customerId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ])

    const isBillable = typeRes.data?.is_billable ?? true
    const preferredCardId =
      (customerRes.data as { default_rate_card_id?: string | null } | null)
        ?.default_rate_card_id ?? null

    let created = 0
    let skipped = 0
    const failed: string[] = []

    for (const occurrence of generated.occurrences) {
      const resolution = input.resolutions[occurrence.dayKey] ?? { kind: "book" }
      const times = applyResolution({ ...occurrence, resolution, conflict: false })
      if (!times) {
        skipped++
        continue
      }

      // Priced against the card effective on THIS occurrence's date, so a
      // series spanning a rate change bills correctly on both sides.
      const quote = quoteBooking({
        startsAtMs: new Date(times.startsAt).getTime(),
        endsAtMs: new Date(times.endsAt).getTime(),
        timeZone,
        cards: cardsRes.data ?? [],
        windows: windowsRes.data ?? [],
        overrides: overridesRes.data ?? [],
        bookingTypeId: input.bookingTypeId,
        isBillable,
        preferredCardId,
      })

      const { error } = await supabase.from("rink_bookings").insert({
        facility_id: ctx.facilityId,
        rink_id: input.rinkId,
        customer_id: input.customerId,
        series_id: series.id,
        booking_type_id: input.bookingTypeId,
        title: input.title,
        starts_at: times.startsAt,
        ends_at: times.endsAt,
        buffer_minutes_after: buffer,
        status: input.status,
        rate_snapshot_hourly: quote.snapshotHourlyRate,
        rate_snapshot_prime: quote.allPrime,
        computed_amount: quote.totalAmount,
        notes: input.notes,
        created_by: ctx.employeeId,
      })

      if (error) {
        // 23P01 means the slot was taken between preview and commit. Report the
        // date and keep going — the rest of the contract is still valid.
        failed.push(occurrence.dayKey)
      } else {
        created++
      }
    }

    await enqueueCoverage(ctx.facilityId)
    revalidatePath(CALENDAR_PATH)
    return { ok: true, seriesId: series.id, created, skipped, failed }
  } catch (e) {
    return caught(e)
  }
}

// ---------------------------------------------------------------------------
// Cancel a series — FUTURE occurrences only.
// ---------------------------------------------------------------------------

/**
 * Cancels the remaining occurrences and closes the series.
 *
 * Past occurrences are left exactly as they are: they happened, and they may
 * already be on an invoice. An occurrence that is already billed is skipped
 * even if it is in the future, because cancelling it would leave an invoice
 * line pointing at a cancelled booking.
 */
export async function cancelSeries(
  seriesId: string,
  reason: string,
): Promise<
  { ok: true; cancelled: number; keptBilled: number } | { ok: false; error: string }
> {
  try {
    const ctx = await requireSeriesEditor()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const trimmed = reason.trim()
    if (!trimmed) return { ok: false, error: "Give a reason for cancelling the series." }

    const supabase = await createClient()
    const timeZone = await getFacilityTimezone(supabase, ctx.facilityId)
    const todayKey = dayKeyInTz(new Date(), timeZone)

    const { data: upcoming } = await supabase
      .from("rink_bookings")
      .select("id, starts_at")
      .eq("facility_id", ctx.facilityId)
      .eq("series_id", seriesId)
      .neq("status", "cancelled")
      .gte("starts_at", `${todayKey}T00:00:00.000Z`)

    const ids = (upcoming ?? []).map((b) => b.id)
    if (ids.length === 0) {
      await closeSeries(seriesId, ctx.facilityId)
      return { ok: true, cancelled: 0, keptBilled: 0 }
    }

    // An occurrence already on a live invoice stays put.
    const { data: billed } = await supabase
      .from("rink_invoice_line_items")
      .select("booking_id")
      .eq("facility_id", ctx.facilityId)
      .in("booking_id", ids)
      .eq("voided", false)

    const billedIds = new Set((billed ?? []).map((l) => l.booking_id))
    const cancellable = ids.filter((id) => !billedIds.has(id))

    if (cancellable.length > 0) {
      const { error } = await supabase
        .from("rink_bookings")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          cancelled_by: ctx.employeeId,
          cancellation_reason: trimmed,
        })
        .eq("facility_id", ctx.facilityId)
        .in("id", cancellable)
      if (error) {
        return { ok: false, error: error.message || "Failed to cancel the series." }
      }
    }

    await closeSeries(seriesId, ctx.facilityId)
    await enqueueCoverage(ctx.facilityId)
    revalidatePath(CALENDAR_PATH)
    return { ok: true, cancelled: cancellable.length, keptBilled: billedIds.size }
  } catch (e) {
    return caught(e)
  }
}

async function closeSeries(seriesId: string, facilityId: string): Promise<void> {
  const supabase = await createClient()
  await supabase
    .from("rink_booking_series")
    .update({ status: "cancelled" })
    .eq("id", seriesId)
    .eq("facility_id", facilityId)
}

// ---------------------------------------------------------------------------
// Detach a single occurrence from its series ("this occurrence only").
// ---------------------------------------------------------------------------

/**
 * Editing one occurrence should not silently rewrite the contract, so the
 * occurrence is detached from the series first. It keeps its data and becomes
 * an ordinary standalone booking that the normal edit path can change.
 */
export async function detachOccurrence(bookingId: string): Promise<SimpleResult> {
  try {
    const ctx = await requireSeriesEditor()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const supabase = await createClient()
    const { error } = await supabase
      .from("rink_bookings")
      .update({ series_id: null })
      .eq("id", bookingId)
      .eq("facility_id", ctx.facilityId)
    if (error) {
      return { ok: false, error: error.message || "Failed to detach the booking." }
    }

    revalidatePath(CALENDAR_PATH)
    return { ok: true }
  } catch (e) {
    return caught(e)
  }
}

// ---------------------------------------------------------------------------
// "This and future" — split the series.
// ---------------------------------------------------------------------------

export type SplitSeriesResult =
  | { ok: true; newSeriesId: string; replaced: number; keptBilled: number; failed: string[] }
  | { ok: false; error: string }

/**
 * Ends the existing series the day before `fromDayKey` and starts a new one
 * carrying the changed pattern.
 *
 * This is a genuine split rather than an in-place rewrite because the old
 * occurrences are history: they were quoted, possibly invoiced, and agreed at
 * the old terms. Occurrences already on a live invoice are left alone and
 * reported back, since replacing one would strand its invoice line.
 */
export async function splitSeries(input: {
  seriesId: string
  fromDayKey: string
  rinkId: string
  bookingTypeId: string
  customerId: string | null
  title: string | null
  notes: string | null
  status: "tentative" | "confirmed"
  startTime: string
  endTime: string
  daysOfWeek: number[]
  intervalWeeks: number
}): Promise<SplitSeriesResult> {
  try {
    const ctx = await requireSeriesEditor()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const supabase = await createClient()

    const { data: original } = await supabase
      .from("rink_booking_series")
      .select("*")
      .eq("id", input.seriesId)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle()
    if (!original) return { ok: false, error: "Series not found." }

    // Everything from the split date onward is replaced, except what is billed.
    const { data: future } = await supabase
      .from("rink_bookings")
      .select("id")
      .eq("facility_id", ctx.facilityId)
      .eq("series_id", input.seriesId)
      .neq("status", "cancelled")
      .gte("starts_at", `${input.fromDayKey}T00:00:00.000Z`)

    const futureIds = (future ?? []).map((b) => b.id)
    let keptBilled = 0

    if (futureIds.length > 0) {
      const { data: billed } = await supabase
        .from("rink_invoice_line_items")
        .select("booking_id")
        .eq("facility_id", ctx.facilityId)
        .in("booking_id", futureIds)
        .eq("voided", false)
      const billedIds = new Set((billed ?? []).map((l) => l.booking_id))
      keptBilled = billedIds.size

      const removable = futureIds.filter((id) => !billedIds.has(id))
      if (removable.length > 0) {
        // Deleted rather than cancelled: these are being REPLACED, and leaving
        // cancelled ghosts would clutter the calendar and the audit trail with
        // rows that never really happened.
        await supabase
          .from("rink_bookings")
          .delete()
          .eq("facility_id", ctx.facilityId)
          .in("id", removable)
      }
    }

    // Close the original the day before the split.
    await supabase
      .from("rink_booking_series")
      .update({ series_end_date: addDaysToKey(input.fromDayKey, -1) })
      .eq("id", input.seriesId)
      .eq("facility_id", ctx.facilityId)

    const created = await createSeries({
      rinkId: input.rinkId,
      bookingTypeId: input.bookingTypeId,
      customerId: input.customerId,
      title: input.title,
      notes: input.notes,
      status: input.status,
      recurrence: {
        daysOfWeek: input.daysOfWeek,
        startTime: input.startTime,
        endTime: input.endTime,
        seriesStartDate: input.fromDayKey,
        seriesEndDate: original.series_end_date,
        intervalWeeks: input.intervalWeeks,
      },
      resolutions: {},
    })

    if (!created.ok) return { ok: false, error: created.error }

    revalidatePath(CALENDAR_PATH)
    return {
      ok: true,
      newSeriesId: created.seriesId,
      replaced: created.created,
      keptBilled,
      failed: created.failed,
    }
  } catch (e) {
    return caught(e)
  }
}

async function enqueueCoverage(facilityId: string): Promise<void> {
  try {
    const supabase = await createClient()
    await supabase
      .from("rink_coverage_reeval_queue")
      .insert({ facility_id: facilityId, reason: "booking_change", status: "pending" })
  } catch {
    // Best-effort; the sweep also runs on a schedule.
  }
}
