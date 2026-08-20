// Pure geometry + windowing for the booking calendar.
//
// Dependency-free apart from src/lib/timezone.ts (Intl only), so vitest runs it
// in plain Node.
//
// EVERYTHING HERE IS FACILITY-LOCAL. The grid's Y axis is minutes past local
// midnight at the rink; the stored instants are UTC. Mixing the two is the
// classic way a scheduling grid ends up an hour out twice a year, so the
// conversion happens once, here, at the edges.
//
// One simplification worth naming: within a single rink column, blocks can
// never overlap — the rink_bookings_no_overlap exclusion constraint makes it
// impossible — so there is no side-by-side packing to compute. Any visual
// overlap would be a bug in this file, not a legitimate state.

import { dayKeyInTz, minutesOfDayInTz, weekdayOfKey } from "@/lib/timezone"

export type DayWindow = {
  /** Minutes past local midnight. */
  openMinute: number
  closeMinute: number
  isClosed: boolean
  /** True when the window runs past midnight into the next calendar day. */
  wrapsMidnight: boolean
  /** Set when an exception replaced the weekly hours; shown to explain why. */
  exceptionLabel: string | null
}

export type HoursRow = {
  day_of_week: number
  open_time: string | null
  close_time: string | null
  is_closed: boolean
}

export type ExceptionRow = {
  exception_date: string
  open_time: string | null
  close_time: string | null
  is_closed: boolean
  label: string
}

function parseHm(value: string | null): number | null {
  if (!value) return null
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/**
 * The operating window for one facility-local date.
 *
 * An exception for the date REPLACES the weekly row entirely rather than
 * merging with it — a holiday's hours are the hours, not an adjustment.
 */
export function resolveDayWindow(
  dayKey: string,
  hours: HoursRow[],
  exceptions: ExceptionRow[],
): DayWindow {
  const exception = exceptions.find((e) => e.exception_date === dayKey)
  if (exception) {
    if (exception.is_closed) {
      return {
        openMinute: 0,
        closeMinute: 0,
        isClosed: true,
        wrapsMidnight: false,
        exceptionLabel: exception.label,
      }
    }
    const open = parseHm(exception.open_time) ?? 0
    const close = parseHm(exception.close_time) ?? 0
    return {
      openMinute: open,
      closeMinute: close,
      isClosed: false,
      wrapsMidnight: close < open,
      exceptionLabel: exception.label,
    }
  }

  const dow = weekdayOfKey(dayKey)
  const row = hours.find((h) => h.day_of_week === dow)
  if (!row || row.is_closed) {
    return {
      openMinute: 0,
      closeMinute: 0,
      isClosed: true,
      wrapsMidnight: false,
      exceptionLabel: null,
    }
  }

  const open = parseHm(row.open_time) ?? 0
  const close = parseHm(row.close_time) ?? 1440
  return {
    openMinute: open,
    closeMinute: close,
    isClosed: false,
    wrapsMidnight: close < open,
    exceptionLabel: null,
  }
}

/**
 * The visible extent of the grid for a day.
 *
 * Before/after-hours time is SHADED, not hidden: booking outside hours is
 * allowed (it just raises a coverage flag), so the grid has to be able to show
 * one. The window therefore stretches to include any booking that escapes the
 * operating hours, padded to whole hours so the axis labels stay tidy.
 */
export function gridExtent(
  window: DayWindow,
  bookingMinutes: Array<{ startMinute: number; endMinute: number }>,
): { startMinute: number; endMinute: number } {
  let start = window.isClosed ? 6 * 60 : window.openMinute
  let end = window.isClosed ? 23 * 60 : window.wrapsMidnight ? 1440 : window.closeMinute

  for (const b of bookingMinutes) {
    start = Math.min(start, b.startMinute)
    end = Math.max(end, b.endMinute)
  }

  start = Math.max(0, Math.floor(start / 60) * 60)
  end = Math.min(1440, Math.ceil(end / 60) * 60)

  // Never collapse to nothing, and always show a usable span.
  if (end - start < 120) end = Math.min(1440, start + 120)
  return { startMinute: start, endMinute: end }
}

/** Whole-hour tick marks for the Y axis. */
export function hourTicks(startMinute: number, endMinute: number): number[] {
  const ticks: number[] = []
  for (let m = Math.ceil(startMinute / 60) * 60; m <= endMinute; m += 60) {
    ticks.push(m)
  }
  return ticks
}

export type BlockGeometry = {
  topPct: number
  heightPct: number
  /** The buffer tail, as a share of the whole grid, drawn hatched below the
   *  block so the true bookable gap is visible. */
  bufferPct: number
}

/**
 * Position a booking within the grid, in percentages so the container can be
 * any height. Clamped to the extent: a booking running past the visible window
 * is truncated visually rather than overflowing the grid.
 */
export function blockGeometry(
  startMinute: number,
  endMinute: number,
  bufferMinutes: number,
  extent: { startMinute: number; endMinute: number },
): BlockGeometry {
  const span = Math.max(1, extent.endMinute - extent.startMinute)
  const clampedStart = Math.max(startMinute, extent.startMinute)
  const clampedEnd = Math.min(endMinute, extent.endMinute)
  const clampedBufferEnd = Math.min(endMinute + bufferMinutes, extent.endMinute)

  const topPct = ((clampedStart - extent.startMinute) / span) * 100
  const heightPct = (Math.max(0, clampedEnd - clampedStart) / span) * 100
  const bufferPct = (Math.max(0, clampedBufferEnd - clampedEnd) / span) * 100

  return { topPct, heightPct, bufferPct }
}

/** Where a booking sits on a given local day, in minutes past local midnight.
 *  A booking that started on a previous day clamps to 0 so it still renders. */
export function bookingMinutesOnDay(
  startsAtIso: string,
  endsAtIso: string,
  dayKey: string,
  timeZone: string | null,
): { startMinute: number; endMinute: number } | null {
  const start = new Date(startsAtIso)
  const end = new Date(endsAtIso)
  const startDay = dayKeyInTz(start, timeZone)
  const endDay = dayKeyInTz(end, timeZone)

  if (startDay !== dayKey && endDay !== dayKey && !(startDay < dayKey && endDay > dayKey)) {
    return null
  }

  const startMinute = startDay === dayKey ? minutesOfDayInTz(start, timeZone) : 0
  const endMinute = endDay === dayKey ? minutesOfDayInTz(end, timeZone) : 1440

  // A booking ending exactly at local midnight belongs to the day it ran
  // through, not to the next one.
  if (endDay === dayKey && endMinute === 0) return null

  return { startMinute, endMinute }
}

/** "6:00 PM" style label for an axis tick or a block, facility-local. */
export function formatMinuteLabel(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440
  const h24 = Math.floor(m / 60)
  const mm = m % 60
  const suffix = h24 >= 12 ? "PM" : "AM"
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return mm === 0 ? `${h12} ${suffix}` : `${h12}:${String(mm).padStart(2, "0")} ${suffix}`
}

/** Snap a minute value to the facility's configured slot increment. */
export function snapToSlot(minute: number, slotMinutes: number): number {
  if (slotMinutes <= 0) return minute
  return Math.round(minute / slotMinutes) * slotMinutes
}
