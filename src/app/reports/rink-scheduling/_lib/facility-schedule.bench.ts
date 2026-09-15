// Performance harness for the facility ice schedule (rink-scheduling).
//
// WHY THIS EXISTS. The calendar loads an UNFILTERED window of bookings for the
// whole facility — 34 days for day/week/agenda, the full 42-cell grid for
// month (see load-calendar.ts: no rink filter, no row cap) — and then every
// view re-slices that array in a plain component body on each render. The cost
// is therefore O(rinks x days x bookings), and each element pays a facility
// timezone conversion. That is exactly the shape that behaves fine on a
// one-sheet rink with a quiet week and falls over on a four-sheet complex in
// tournament season, so it needs a number attached to it rather than a guess.
//
// Run with:  pnpm bench
//
// The sizes below are booking COUNTS in the loaded window, not per day:
//   quiet     ~  1 sheet, ~10 bookings/day     -> a single-pad community rink
//   busy      ~  3 sheets, ~18 bookings/day    -> a typical multi-pad complex
//   tournament~  4 sheets, ~30 bookings/day    -> a holiday tournament weekend
//
// Nothing here touches the database or the network: these are the pure models,
// measured in isolation, so a regression points at a specific function.

import { bench, describe } from "vitest"

import { addDaysToKey, dayKeyInTz, minutesOfDayInTz } from "@/lib/timezone"

import { buildDeskAgenda, type DeskRinkRow, type DeskTypeRow } from "./desk-agenda"
import { findOpenStartsForDay } from "./find-slot"
import {
  blockGeometry,
  bookingMinutesOnDay,
  gridExtent,
  hourTicks,
  resolveDayWindow,
  type ExceptionRow,
  type HoursRow,
} from "./grid-model"
import { buildMonthGrid, monthGridRange } from "./month-model"

const TZ = "America/New_York"
const FOCUS_KEY = "2026-01-15"

type Booking = {
  id: string
  rink_id: string
  booking_type_id: string
  starts_at: string
  ends_at: string
  status: string
  coverage_status: string
  title: string | null
  resurface_status: string | null
}

/** Deterministic PRNG so every run measures the same dataset. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

/**
 * A facility's loaded booking window: `rinks` sheets x `perDay` bookings a day
 * across `days` days, starting at 6am local and stepping in 45-minute blocks
 * (ice time plus flood), which is how a real sheet fills up.
 */
function makeBookings(rinks: number, days: number, perDay: number, fromKey: string): Booking[] {
  const random = rng(20260115)
  const out: Booking[] = []
  for (let d = 0; d < days; d++) {
    const dayKey = addDaysToKey(fromKey, d)
    for (let r = 0; r < rinks; r++) {
      for (let i = 0; i < perDay; i++) {
        const startMinute = 6 * 60 + i * 45
        const endMinute = startMinute + 40
        const hh = (m: number) => String(Math.floor(m / 60) % 24).padStart(2, "0")
        const mm = (m: number) => String(m % 60).padStart(2, "0")
        // Local wall clock -> the stored UTC instant, US Eastern in January.
        const toIso = (m: number) => {
          const key = m >= 1440 ? addDaysToKey(dayKey, 1) : dayKey
          return `${key}T${hh(m + 5 * 60)}:${mm(m)}:00.000Z`
        }
        out.push({
          id: `b-${d}-${r}-${i}`,
          rink_id: `rink-${r}`,
          booking_type_id: `type-${i % 5}`,
          starts_at: toIso(startMinute),
          ends_at: toIso(endMinute),
          status: random() < 0.04 ? "cancelled" : "confirmed",
          coverage_status: random() < 0.08 ? "uncovered" : "covered",
          title: `Booking ${i}`,
          resurface_status: null,
        })
      }
    }
  }
  return out.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
}

const HOURS: HoursRow[] = Array.from({ length: 7 }, (_, dow) => ({
  day_of_week: dow,
  open_time: "05:30",
  close_time: "23:30",
  is_closed: false,
}))

const EXCEPTIONS: ExceptionRow[] = [
  { exception_date: "2026-01-01", open_time: "08:00", close_time: "20:00", is_closed: false, label: "New Year's Day" },
  { exception_date: "2026-12-25", open_time: null, close_time: null, is_closed: true, label: "Christmas" },
]

type Profile = { name: string; rinks: number; perDay: number }

const PROFILES: Profile[] = [
  { name: "quiet (1 sheet x 10/day)", rinks: 1, perDay: 10 },
  { name: "busy (3 sheets x 18/day)", rinks: 3, perDay: 18 },
  { name: "tournament (4 sheets x 30/day)", rinks: 4, perDay: 30 },
]

// The day/week/agenda window the loader actually fetches: focus - 9 through
// focus + 23, widened a day on each side for the UTC/local slack.
const WINDOW_DAYS = 9 + 23 + 3
const WINDOW_FROM = addDaysToKey(FOCUS_KEY, -10)

// The month view sizes its own window from the grid range.
const MONTH_RANGE = monthGridRange(FOCUS_KEY)
const MONTH_DAYS = 42

const WEEK_DAYS = Array.from({ length: 7 }, (_, i) => addDaysToKey("2026-01-11", i))

/** What WeekGrid does in its (unmemoized) component body, verbatim. */
function assembleWeekColumns(bookings: Booking[], rinkId: string) {
  return WEEK_DAYS.map((dayKey) => {
    const window = resolveDayWindow(dayKey, HOURS, EXCEPTIONS)
    const items = bookings
      .filter((b) => b.rink_id === rinkId)
      .map((b) => {
        const m = bookingMinutesOnDay(b.starts_at, b.ends_at, dayKey, TZ)
        return m ? { booking: b, ...m } : null
      })
      .filter((x): x is { booking: Booking; startMinute: number; endMinute: number } => x !== null)
    return { dayKey, window, items }
  })
}

/** What DayGrid does: every rink column for one day, then geometry per block. */
function assembleDayColumns(bookings: Booking[], rinkIds: string[]) {
  const window = resolveDayWindow(FOCUS_KEY, HOURS, EXCEPTIONS)
  const placed = rinkIds.map((rinkId) => ({
    rinkId,
    items: bookings
      .filter((b) => b.rink_id === rinkId)
      .map((b) => {
        const m = bookingMinutesOnDay(b.starts_at, b.ends_at, FOCUS_KEY, TZ)
        return m ? { booking: b, ...m } : null
      })
      .filter((x): x is { booking: Booking; startMinute: number; endMinute: number } => x !== null),
  }))
  const extent = gridExtent(window, placed.flatMap((c) => c.items))
  hourTicks(extent.startMinute, extent.endMinute)
  for (const col of placed) {
    for (const item of col.items) {
      blockGeometry(item.startMinute, item.endMinute, 15, extent)
    }
  }
  return placed
}

/** What AgendaList does: a fortnight of days, each re-slicing every booking. */
function assembleAgenda(bookings: Booking[], days: number) {
  const out: unknown[] = []
  for (let d = 0; d < days; d++) {
    const dayKey = addDaysToKey(FOCUS_KEY, d)
    const items = bookings
      .map((b) => {
        const m = bookingMinutesOnDay(b.starts_at, b.ends_at, dayKey, TZ)
        return m ? { booking: b, ...m } : null
      })
      .filter((x) => x !== null)
    out.push(items)
  }
  return out
}

for (const profile of PROFILES) {
  const windowBookings = makeBookings(profile.rinks, WINDOW_DAYS, profile.perDay, WINDOW_FROM)
  const monthBookings = makeBookings(profile.rinks, MONTH_DAYS, profile.perDay, MONTH_RANGE.fromKey)
  const rinkIds = Array.from({ length: profile.rinks }, (_, i) => `rink-${i}`)

  describe(`day view — ${profile.name} — ${windowBookings.length} rows loaded`, () => {
    bench("assemble rink columns + block geometry", () => {
      assembleDayColumns(windowBookings, rinkIds)
    })
  })

  describe(`week view — ${profile.name} — ${windowBookings.length} rows loaded`, () => {
    bench("assemble 7 day columns for one sheet", () => {
      assembleWeekColumns(windowBookings, "rink-0")
    })
  })

  describe(`month view — ${profile.name} — ${monthBookings.length} rows loaded`, () => {
    bench("buildMonthGrid (all rinks)", () => {
      buildMonthGrid(FOCUS_KEY, monthBookings, TZ, FOCUS_KEY, { rinkId: null })
    })
  })

  describe(`agenda view — ${profile.name} — ${windowBookings.length} rows loaded`, () => {
    bench("slice 14 days", () => {
      assembleAgenda(windowBookings, 14)
    })
  })
}

// ── Front desk ────────────────────────────────────────────────────────────
{
  const bookings = makeBookings(4, WINDOW_DAYS, 30, WINDOW_FROM)
  const rinkById = new Map<string, DeskRinkRow>(
    Array.from({ length: 4 }, (_, i) => [`rink-${i}`, { id: `rink-${i}`, name: `Rink ${i + 1}` }]),
  )
  const typeById = new Map<string, DeskTypeRow>(
    Array.from({ length: 5 }, (_, i) => [
      `type-${i}`,
      { id: `type-${i}`, name: `Type ${i}`, color: "#002244", slug: `type-${i}`, is_resurface: i === 4 },
    ]),
  )

  describe(`front desk — tournament — ${bookings.length} rows loaded`, () => {
    bench("buildDeskAgenda for one day", () => {
      buildDeskAgenda({ bookings, rinkById, typeById, dayKey: FOCUS_KEY, timeZone: TZ })
    })
  })
}

// ── Open-slot search ──────────────────────────────────────────────────────
{
  const dayStart = Date.UTC(2026, 0, 15, 11, 0, 0) // 6:00am US Eastern
  const blocked = Array.from({ length: 30 }, (_, i) => ({
    startMs: dayStart + i * 45 * 60_000,
    endMs: dayStart + i * 45 * 60_000 + 55 * 60_000,
  }))

  describe("find a slot — a full 18-hour sheet", () => {
    bench("findOpenStartsForDay (30 blocked, 15-min step)", () => {
      findOpenStartsForDay({
        openMs: dayStart,
        closeMs: dayStart + 18 * 3_600_000,
        blocked,
        durationMs: 60 * 60_000,
        newBufferMs: 15 * 60_000,
        stepMs: 15 * 60_000,
        notBeforeMs: dayStart,
        limit: 10,
      })
    })
  })
}

// ── The per-element timezone cost these views all pay ─────────────────────
{
  const instant = "2026-01-15T18:30:00.000Z"

  describe("timezone conversion — the per-booking floor", () => {
    bench("dayKeyInTz", () => {
      dayKeyInTz(instant, TZ)
    })
    bench("minutesOfDayInTz", () => {
      minutesOfDayInTz(instant, TZ)
    })
    bench("bookingMinutesOnDay (2x dayKeyInTz + 1x minutesOfDayInTz)", () => {
      bookingMinutesOnDay(instant, "2026-01-15T19:30:00.000Z", "2026-01-15", TZ)
    })
    bench("baseline: no timezone (runtime-local path)", () => {
      bookingMinutesOnDay(instant, "2026-01-15T19:30:00.000Z", "2026-01-15", null)
    })
  })
}
