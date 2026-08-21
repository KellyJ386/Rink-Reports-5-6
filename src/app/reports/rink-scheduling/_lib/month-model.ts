// Pure calendar math for the month view.
//
// Dependency-free apart from src/lib/timezone.ts (Intl only), so vitest runs it
// in plain Node.
//
// WHY THIS IS A SEPARATE MODEL FROM grid-model.ts. The day and week views lay
// blocks out against a vertical minute axis — their whole geometry is "how far
// down the column does 6:15 PM fall". A month cell has no time axis at all: it
// is a date box holding a short list. Sharing a model would mean one of the two
// carrying coordinates the other never uses, so the two stay separate and only
// share `bookingMinutesOnDay`, which answers the one question both ask: does
// this booking touch this facility-local day?
//
// EVERYTHING HERE IS FACILITY-LOCAL. Day keys are "YYYY-MM-DD" in the rink's
// zone; the stored instants are UTC. A booking that runs 10pm–1am appears in
// BOTH day cells, because from the front desk's point of view the ice is in use
// on both dates.
//
// WEEKS START SUNDAY, matching facility_operating_hours.day_of_week (0 = Sunday)
// and the existing week view. Making that configurable is a facility setting
// nobody has asked for; when they do, it belongs on rink_scheduling_settings
// rather than hardcoded differently in two places.

import { addDaysToKey, dayKeyInTz, weekdayOfKey } from "@/lib/timezone"

import { bookingMinutesOnDay } from "./grid-model"

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/

/** First day of the month a key falls in. */
export function monthStartKey(key: string): string {
  return `${key.slice(0, 7)}-01`
}

/**
 * Step whole months, clamping to the target month's last day.
 *
 * Jan 31 + 1 month is Feb 28/29, not Mar 2 — the naive Date rollover would
 * skip February entirely when paging forward from a 31-day month, which is the
 * classic month-picker bug.
 */
export function addMonthsToKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number)
  const targetMonthIndex = m - 1 + n
  const targetYear = y + Math.floor(targetMonthIndex / 12)
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12
  const lastDay = daysInMonth(targetYear, targetMonth)
  const pad = (x: number) => String(x).padStart(2, "0")
  return `${targetYear}-${pad(targetMonth + 1)}-${pad(Math.min(d, lastDay))}`
}

/** Days in a zero-indexed month, proleptic Gregorian (matches JS Date). */
export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0, 12)).getUTCDate()
}

/**
 * Inclusive day-key range the month grid renders: the Sunday on or before the
 * 1st, through the Saturday on or after the last day.
 *
 * The page uses this to size its query window, so the grid and the data it is
 * given always agree on where the month begins and ends.
 */
export function monthGridRange(key: string): { fromKey: string; toKey: string } {
  const first = monthStartKey(key)
  const [y, m] = first.split("-").map(Number)
  const last = `${first.slice(0, 7)}-${String(daysInMonth(y, m - 1)).padStart(2, "0")}`
  return {
    fromKey: addDaysToKey(first, -weekdayOfKey(first)),
    toKey: addDaysToKey(last, 6 - weekdayOfKey(last)),
  }
}

export type MonthBookingLike = {
  id: string
  starts_at: string
  ends_at: string
  rink_id: string
  status: string
  coverage_status: string
}

export type MonthCell<B> = {
  dayKey: string
  /** Day number, for the cell's corner label. */
  dayOfMonth: number
  /** False for the leading/trailing days that only exist to square off the
   *  grid. They still render — a booking on the 31st of last month is real —
   *  but they are dimmed. */
  inMonth: boolean
  isToday: boolean
  /** Bookings touching this day, earliest first. */
  bookings: B[]
  /** Live bookings only (cancelled excluded), for the count badge. */
  liveCount: number
  /** True when any live booking on this day carries an unresolved coverage
   *  gap — the month view's whole reason to exist is spotting these at a
   *  glance without opening every day. */
  hasCoverageGap: boolean
}

export type MonthGrid<B> = {
  /** First of the month this grid is centred on. */
  monthKey: string
  /** Complete weeks, Sunday-first. 4 to 6 rows depending on the month. */
  weeks: MonthCell<B>[][]
  /** Live bookings across the in-month days only. */
  monthLiveCount: number
}

export type BuildMonthGridOptions = {
  /** Restrict to one rink. Null shows every rink, which is the default: the
   *  point of a month view is the whole building at a glance. */
  rinkId?: string | null
  /** Cancelled bookings are hidden unless the caller opts in, matching the
   *  day/week views' `showCancelled` toggle. */
  showCancelled?: boolean
}

/**
 * Fold bookings into a Sunday-first grid of complete weeks for `focusKey`'s
 * month.
 *
 * Generic over the booking type so the model stays free of the view row's
 * display fields; the component passes `BookingView` and gets it back.
 */
export function buildMonthGrid<B extends MonthBookingLike>(
  focusKey: string,
  bookings: readonly B[],
  timeZone: string | null,
  todayKey: string,
  options: BuildMonthGridOptions = {},
): MonthGrid<B> {
  const monthKey = monthStartKey(KEY_RE.test(focusKey) ? focusKey : todayKey)
  const monthPrefix = monthKey.slice(0, 7)
  const { fromKey, toKey } = monthGridRange(monthKey)

  const relevant = bookings.filter((b) => {
    if (options.rinkId && b.rink_id !== options.rinkId) return false
    if (!options.showCancelled && b.status === "cancelled") return false
    return true
  })

  // Bucket by day key in one pass. A booking spanning midnight lands in every
  // day it touches, so this is a scatter rather than a partition.
  const byDay = new Map<string, B[]>()
  for (const booking of relevant) {
    for (const dayKey of daysTouched(booking, fromKey, toKey, timeZone)) {
      const list = byDay.get(dayKey)
      if (list) list.push(booking)
      else byDay.set(dayKey, [booking])
    }
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
  }

  const weeks: MonthCell<B>[][] = []
  let monthLiveCount = 0
  let cursor = fromKey
  while (cursor <= toKey) {
    const week: MonthCell<B>[] = []
    for (let i = 0; i < 7; i++) {
      const dayBookings = byDay.get(cursor) ?? []
      const live = dayBookings.filter((b) => b.status !== "cancelled")
      const inMonth = cursor.slice(0, 7) === monthPrefix
      if (inMonth) monthLiveCount += live.length
      week.push({
        dayKey: cursor,
        dayOfMonth: Number(cursor.slice(8)),
        inMonth,
        isToday: cursor === todayKey,
        bookings: dayBookings,
        liveCount: live.length,
        hasCoverageGap: live.some((b) => b.coverage_status !== "covered"),
      })
      cursor = addDaysToKey(cursor, 1)
    }
    weeks.push(week)
  }

  return { monthKey, weeks, monthLiveCount }
}

/**
 * Every day key in [fromKey, toKey] that this booking occupies.
 *
 * Walks only the booking's own span, clamped to the grid, so a 90-minute
 * booking costs one or two checks rather than scanning all 42 cells.
 * `bookingMinutesOnDay` still decides each day, so the midnight-boundary rule
 * is defined in exactly one place for all three views.
 */
function daysTouched(
  booking: MonthBookingLike,
  fromKey: string,
  toKey: string,
  timeZone: string | null,
): string[] {
  const startDay = safeDayKey(booking.starts_at, timeZone)
  const endDay = safeDayKey(booking.ends_at, timeZone)
  if (!startDay || !endDay || endDay < startDay) return []

  const first = startDay > fromKey ? startDay : fromKey
  const last = endDay < toKey ? endDay : toKey

  const out: string[] = []
  for (let day = first; day <= last; day = addDaysToKey(day, 1)) {
    if (bookingMinutesOnDay(booking.starts_at, booking.ends_at, day, timeZone)) {
      out.push(day)
    }
  }
  return out
}

function safeDayKey(iso: string, timeZone: string | null): string | null {
  if (Number.isNaN(Date.parse(iso))) return null
  return dayKeyInTz(iso, timeZone)
}

/** "August 2026", for the month view's header. */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number)
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 15, 12)))
}
