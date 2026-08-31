"use server"

import { getCurrentUser, requireUser } from "@/lib/auth"
import { getFacilityTimezone } from "@/lib/facility-timezone"
import { logServerError } from "@/lib/observability/log-server-error"
import { currentUserCan } from "@/lib/permissions/check"
import { resolveBufferMinutes } from "@/lib/rink-scheduling/buffer"
import { createClient } from "@/lib/supabase/server"
import { addDaysToKey, dayKeyInTz, wallTimeToUtc } from "@/lib/timezone"

import { findOpenStartsForDay } from "./_lib/find-slot"
import { resolveDayWindow } from "./_lib/grid-model"

// ---------------------------------------------------------------------------
// "Find a slot" — the front-desk phone-call answer. READ-ONLY: this file
// performs only SELECTs; picking a result hands the caller to the ordinary
// booking sheet, whose createBooking action re-checks permission and lets the
// exclusion constraint referee, so a stale result loses politely.
//
// Gated at `view` — the search reveals exactly what the calendar already
// shows that tier (where ice is free), never rates or customer data.
// facility_id comes from the session; RLS scopes every read independently.
// ---------------------------------------------------------------------------

/** Search caps: enough for "next week or two", bounded for a shared server. */
const MAX_RANGE_DAYS = 14
const MAX_RESULTS = 40
const MAX_PER_DAY_PER_RINK = 6

export type OpenSlot = {
  rinkId: string
  rinkName: string
  dayKey: string
  /** Facility-local minutes past midnight, for formatMinuteLabel. */
  startMinute: number
  endMinute: number
}

export type FindSlotsResult =
  | { ok: true; slots: OpenSlot[]; truncated: boolean }
  | { ok: false; error: string }

export async function findOpenSlots(input: {
  durationMinutes: number
  fromDayKey: string
  days: number
  rinkId?: string | null
}): Promise<FindSlotsResult> {
  try {
    await requireUser()
    const current = await getCurrentUser()
    const facilityId = current?.profile?.facility_id
    if (!facilityId) return { ok: false, error: "No facility assigned to your account." }

    const supabase = await createClient()
    if (!(await currentUserCan(supabase, "rink_scheduling", "view"))) {
      return { ok: false, error: "Finding a slot needs the Rink Scheduling permission." }
    }

    const duration = Math.trunc(input.durationMinutes)
    if (!Number.isFinite(duration) || duration < 15 || duration > 8 * 60) {
      return { ok: false, error: "Duration must be between 15 minutes and 8 hours." }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fromDayKey)) {
      return { ok: false, error: "Pick a valid start date." }
    }
    const days = Math.min(Math.max(Math.trunc(input.days) || 1, 1), MAX_RANGE_DAYS)

    const timeZone = await getFacilityTimezone(supabase, facilityId)
    const todayKey = dayKeyInTz(new Date(), timeZone)
    // Searching the past answers nothing; quietly start from today.
    const fromKey = input.fromDayKey < todayKey ? todayKey : input.fromDayKey
    const toKey = addDaysToKey(fromKey, days - 1)

    const [rinksRes, settingsRes, hoursRes, exceptionsRes] = await Promise.all([
      supabase
        .from("facility_rinks")
        .select("id, name, buffer_minutes_override")
        .eq("facility_id", facilityId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("rink_scheduling_settings")
        .select("slot_increment_minutes, default_buffer_minutes, buffer_included_in_rental")
        .eq("facility_id", facilityId)
        .maybeSingle(),
      supabase
        .from("facility_operating_hours")
        .select("day_of_week, open_time, close_time, is_closed")
        .eq("facility_id", facilityId),
      supabase
        .from("facility_operating_hours_exceptions")
        .select("exception_date, open_time, close_time, is_closed, label")
        .eq("facility_id", facilityId)
        .gte("exception_date", fromKey)
        .lte("exception_date", toKey),
    ])

    const allRinks = rinksRes.data ?? []
    const rinks = input.rinkId ? allRinks.filter((r) => r.id === input.rinkId) : allRinks
    if (rinks.length === 0) {
      return { ok: false, error: "No matching rink is set up for this facility." }
    }

    const settings = settingsRes.data
    const stepMinutes = settings?.slot_increment_minutes ?? 30

    // One bookings read for the whole span, slack a day each side (the same
    // convention the calendar page uses): a booking that starts the previous
    // local day can still block the first morning slot.
    const queryFromKey = addDaysToKey(fromKey, -1)
    const queryToKey = addDaysToKey(toKey, 1)
    const { data: bookingRows } = await supabase
      .from("rink_bookings")
      .select("rink_id, starts_at, blocks_until")
      .eq("facility_id", facilityId)
      .neq("status", "cancelled")
      .gte("starts_at", `${queryFromKey}T00:00:00.000Z`)
      .lte("starts_at", `${queryToKey}T23:59:59.999Z`)

    const blockedByRink = new Map<string, { startMs: number; endMs: number }[]>()
    for (const b of bookingRows ?? []) {
      const list = blockedByRink.get(b.rink_id) ?? []
      list.push({
        startMs: new Date(b.starts_at).getTime(),
        endMs: new Date(b.blocks_until).getTime(),
      })
      blockedByRink.set(b.rink_id, list)
    }

    const nowMs = Date.now()
    const slots: OpenSlot[] = []
    let truncated = false

    outer: for (let i = 0; i < days; i++) {
      const dayKey = addDaysToKey(fromKey, i)
      const window = resolveDayWindow(dayKey, hoursRes.data ?? [], exceptionsRes.data ?? [])
      // The calendar allows booking a closed day (flagged for coverage), but
      // a SEARCH offering closed-building ice would mislead the phone call —
      // closed days are simply skipped here.
      if (window.isClosed) continue

      const openWall = wallTimeToUtc(
        `${dayKey}T${String(Math.floor(window.openMinute / 60)).padStart(2, "0")}:${String(window.openMinute % 60).padStart(2, "0")}`,
        timeZone,
      )
      if (!openWall) continue
      const openMs = openWall.getTime()
      // A wrapping window (6:00–2:00) closes past midnight; a non-wrapping
      // one closes the same local day. Minutes-from-open keeps both honest.
      const spanMinutes = window.wrapsMidnight
        ? window.closeMinute + 1440 - window.openMinute
        : window.closeMinute - window.openMinute
      const closeMs = openMs + spanMinutes * 60_000

      for (const rink of rinks) {
        const newBufferMinutes = resolveBufferMinutes({
          facilityDefaultMinutes: settings?.default_buffer_minutes,
          rinkOverrideMinutes: rink.buffer_minutes_override,
          includedInRental: settings?.buffer_included_in_rental,
        })

        const starts = findOpenStartsForDay({
          openMs,
          closeMs,
          blocked: blockedByRink.get(rink.id) ?? [],
          durationMs: duration * 60_000,
          newBufferMs: newBufferMinutes * 60_000,
          stepMs: stepMinutes * 60_000,
          notBeforeMs: dayKey === todayKey ? nowMs : openMs,
          limit: MAX_PER_DAY_PER_RINK,
        })

        for (const startMs of starts) {
          const rawMinute = window.openMinute + Math.round((startMs - openMs) / 60_000)
          // A wrapping window can offer a start past local midnight (a 1 AM
          // slot on a 6:00–2:00 rink). Normalize to the day it actually lands
          // on, so the label reads honestly and the booking sheet books the
          // right date.
          const rolled = rawMinute >= 1440
          slots.push({
            rinkId: rink.id,
            rinkName: rink.name,
            dayKey: rolled ? addDaysToKey(dayKey, 1) : dayKey,
            startMinute: rolled ? rawMinute - 1440 : rawMinute,
            endMinute: (rolled ? rawMinute - 1440 : rawMinute) + duration,
          })
          if (slots.length >= MAX_RESULTS) {
            truncated = true
            break outer
          }
        }
      }
    }

    return { ok: true, slots, truncated }
  } catch (e) {
    logServerError("reports/rink-scheduling/find-slot-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}
