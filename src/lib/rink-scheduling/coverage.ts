// Pure coverage evaluation for Rink Scheduling & Billing.
//
// Dependency-free apart from src/lib/timezone.ts (Intl only), so vitest runs it
// in plain Node. The database reads live in the sweep that calls this.
//
// TWO INDEPENDENT CHECKS, either of which can flag a booking:
//
//   gap_hours    — some part of the booking, INCLUDING its resurfacing buffer,
//                  falls outside the facility's operating hours for that date.
//   gap_staffing — no single PUBLISHED shift spans the whole booking window,
//                  buffer included.
//
// On the staffing rule: containment by ONE shift, not a union of several. Two
// back-to-back shifts leave a changeover moment with nobody committed to the
// building, and this check exists precisely to surface "is someone definitely
// here for all of it". The stricter reading produces more flags, and a flag is
// a notification rather than a block, so the cost of over-flagging is low and
// the cost of under-flagging is an empty rink with paying customers in it.
//
// On published state: the caller MUST have filtered to status = 'published'.
// A cancelled shift keeps its published_at stamp, so `published_at is not
// null` and `status <> 'draft'` are both wrong; the query that feeds this is
// the enforcement point, and it is asserted in the SQL harness.

import { addDaysToKey, dayKeyInTz, weekdayOfKey } from "@/lib/timezone"

export type CoverageStatus = "covered" | "gap_hours" | "gap_staffing" | "gap_both"

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
}

export type Interval = { startMs: number; endMs: number }

function parseHm(value: string | null): number | null {
  if (!value) return null
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** Local midnight for a day key, as an absolute instant. */
function localMidnightMs(dayKey: string, timeZone: string | null): number | null {
  // Resolve noon and step back, which avoids the ambiguous hour on a DST
  // transition day landing on a non-existent local midnight.
  const noon = Date.parse(`${dayKey}T12:00:00Z`)
  if (!Number.isFinite(noon)) return null

  // Find the offset by asking what local day/time that instant maps to.
  const probe = new Date(noon)
  const localKey = dayKeyInTz(probe, timeZone)
  const shiftDays =
    localKey === dayKey ? 0 : localKey < dayKey ? 1 : -1
  const adjusted = noon + shiftDays * 86_400_000

  // Now walk back to local 00:00 using the minute-of-day at that instant.
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timeZone ?? undefined,
  }).formatToParts(new Date(adjusted))
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "12")
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0")
  return adjusted - (hour * 60 + minute) * 60_000
}

/**
 * Open intervals for one facility-local date, as absolute instants.
 *
 * A day whose close time precedes its open time runs past midnight, so its
 * interval extends into the following day rather than being treated as empty.
 * An exception for the date REPLACES the weekly row rather than merging.
 */
export function openIntervalsForDay(
  dayKey: string,
  hours: HoursRow[],
  exceptions: ExceptionRow[],
  timeZone: string | null,
): Interval[] {
  const midnight = localMidnightMs(dayKey, timeZone)
  if (midnight === null) return []

  const exception = exceptions.find((e) => e.exception_date === dayKey)
  let openMin: number | null
  let closeMin: number | null

  if (exception) {
    if (exception.is_closed) return []
    openMin = parseHm(exception.open_time)
    closeMin = parseHm(exception.close_time)
  } else {
    const row = hours.find((h) => h.day_of_week === weekdayOfKey(dayKey))
    if (!row || row.is_closed) return []
    openMin = parseHm(row.open_time)
    closeMin = parseHm(row.close_time)
  }

  if (openMin === null || closeMin === null) return []
  if (closeMin === openMin) return []

  const startMs = midnight + openMin * 60_000
  // Past-midnight days close on the following calendar day.
  const endMs =
    closeMin > openMin
      ? midnight + closeMin * 60_000
      : (localMidnightMs(addDaysToKey(dayKey, 1), timeZone) ?? midnight + 86_400_000) +
        closeMin * 60_000

  return [{ startMs, endMs }]
}

/** Merge touching or overlapping intervals so containment can be a single pass. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals]
    .filter((i) => i.endMs > i.startMs)
    .sort((a, b) => a.startMs - b.startMs)
  const merged: Interval[] = []
  for (const i of sorted) {
    const last = merged[merged.length - 1]
    // `<=` merges abutting intervals: a rink open 06:00-24:00 on Friday and
    // 00:00-02:00 on Saturday is continuously open across midnight.
    if (last && i.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, i.endMs)
    } else {
      merged.push({ ...i })
    }
  }
  return merged
}

/** True when [startMs, endMs) sits entirely inside one of the intervals. */
export function isContained(
  startMs: number,
  endMs: number,
  intervals: Interval[],
): boolean {
  return mergeIntervals(intervals).some(
    (i) => i.startMs <= startMs && i.endMs >= endMs,
  )
}

export type CoverageInput = {
  startsAtMs: number
  /** ends_at + buffer: the ice is occupied until the flood is done. */
  blocksUntilMs: number
  timeZone: string | null
  hours: HoursRow[]
  exceptions: ExceptionRow[]
  /** PUBLISHED shifts only — the caller filters on status. */
  publishedShifts: Interval[]
}

/**
 * Evaluate one booking. The buffer is part of the window for BOTH checks: the
 * ice is occupied while it is being resurfaced, and somebody has to be there
 * to do it.
 */
export function evaluateCoverage(input: CoverageInput): CoverageStatus {
  const { startsAtMs, blocksUntilMs, timeZone, hours, exceptions } = input

  // Collect the open intervals of every local day the window touches, so a
  // booking spanning midnight is judged against both days' hours.
  const firstDay = dayKeyInTz(new Date(startsAtMs), timeZone)
  const lastDay = dayKeyInTz(new Date(blocksUntilMs), timeZone)

  const dayKeys = [firstDay]
  // Also include the day before, whose past-midnight hours can cover an
  // early-morning booking.
  dayKeys.unshift(addDaysToKey(firstDay, -1))
  let cursor = firstDay
  let guard = 0
  while (cursor < lastDay && guard++ < 5) {
    cursor = addDaysToKey(cursor, 1)
    dayKeys.push(cursor)
  }

  const openIntervals = dayKeys.flatMap((d) =>
    openIntervalsForDay(d, hours, exceptions, timeZone),
  )

  const hoursOk = isContained(startsAtMs, blocksUntilMs, openIntervals)
  const staffingOk = input.publishedShifts.some(
    (s) => s.startMs <= startsAtMs && s.endMs >= blocksUntilMs,
  )

  if (hoursOk && staffingOk) return "covered"
  if (!hoursOk && !staffingOk) return "gap_both"
  return hoursOk ? "gap_staffing" : "gap_hours"
}

/** Plain-language reason, used in the alert body and the block's tooltip. */
export function describeCoverage(status: CoverageStatus): string {
  switch (status) {
    case "gap_hours":
      return "falls outside the facility's operating hours"
    case "gap_staffing":
      return "has no published shift covering it"
    case "gap_both":
      return "falls outside operating hours and has no published shift covering it"
    default:
      return "is covered"
  }
}
