// Pure recurrence-expansion helpers for "recurring shifts": given a drawn
// (anchor) shift and a weekly recurrence rule, compute the set of additional
// day keys the recurrence should generate. NO server-only imports live here,
// so this module is safe to unit-test in isolation (see recurrence.test.ts)
// and can be reused by server-only shift-creation code that needs the same
// expansion logic.
//
// Day keys are "YYYY-MM-DD" facility-local calendar dates — timezone-free by
// construction (the facility-local date is resolved elsewhere; this module
// only does calendar-day arithmetic on the key string). All date math here
// goes through addDaysToKey / weekdayOfKey from @/lib/timezone rather than
// hand-rolled Date arithmetic.

import { addDaysToKey, weekdayOfKey } from "@/lib/timezone"

/** Longest span a recurrence may cover, anchor to until (12 weeks). */
export const MAX_RANGE_DAYS = 84

/** Most child occurrences a recurrence may generate (anchor/parent excluded). */
export const MAX_OCCURRENCES = 62

export type RecurrenceSpec = {
  /** "YYYY-MM-DD" facility-local date of the drawn (parent) shift. */
  anchorKey: string
  /** 0 = Sunday … 6 = Saturday. Duplicates are ignored. */
  daysOfWeek: number[]
  /** "YYYY-MM-DD" facility-local date, inclusive, the recurrence ends on. */
  untilKey: string
}

export type RecurrenceValidation = { ok: true } | { ok: false; error: string }

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

/** True for a syntactically- and calendrically-valid "YYYY-MM-DD" key. */
function isValidDayKey(key: string): boolean {
  if (!DAY_KEY_RE.test(key)) return false
  const [y, m, d] = key.split("-").map(Number)
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  // UTC-noon probe so an out-of-range day (e.g. Feb 30) rolls over to a
  // different calendar date instead of silently clamping.
  const probe = new Date(Date.UTC(y, m - 1, d, 12))
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  )
}

/** Whole calendar days from `fromKey` to `toKey` (may be negative). */
function daysBetween(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split("-").map(Number)
  const [ty, tm, td] = toKey.split("-").map(Number)
  const fromUtc = Date.UTC(fy, fm - 1, fd, 12)
  const toUtc = Date.UTC(ty, tm - 1, td, 12)
  return Math.round((toUtc - fromUtc) / 86_400_000)
}

function normalizeDaysOfWeek(daysOfWeek: number[]): number[] {
  return Array.from(new Set(daysOfWeek))
}

/**
 * Expand a recurrence spec into the day keys (ascending, deduped) the
 * recurrence should generate IN ADDITION TO the anchor shift itself. The
 * anchor date is never included — the drawn shift already covers it, even
 * when its own weekday is one of the selected `daysOfWeek`.
 *
 * Safe to call on a spec that hasn't been validated: an until date at or
 * before the anchor, or an empty/invalid `daysOfWeek`, yields `[]` rather
 * than looping.
 */
export function expandRecurrenceDates(spec: RecurrenceSpec): string[] {
  if (!isValidDayKey(spec.anchorKey) || !isValidDayKey(spec.untilKey)) return []

  const daysOfWeek = new Set(
    normalizeDaysOfWeek(spec.daysOfWeek).filter(
      (d) => Number.isInteger(d) && d >= 0 && d <= 6,
    ),
  )
  if (daysOfWeek.size === 0) return []

  const totalDays = daysBetween(spec.anchorKey, spec.untilKey)
  if (totalDays <= 0) return []

  const result: string[] = []
  for (let i = 1; i <= totalDays; i++) {
    const key = addDaysToKey(spec.anchorKey, i)
    if (daysOfWeek.has(weekdayOfKey(key))) {
      result.push(key)
    }
  }
  return result
}

/**
 * Validate a recurrence spec before expansion is persisted: malformed or
 * out-of-order dates, an empty/invalid day-of-week selection, a range longer
 * than MAX_RANGE_DAYS, or an expansion that would exceed MAX_OCCURRENCES.
 */
export function validateRecurrenceSpec(
  spec: RecurrenceSpec,
): RecurrenceValidation {
  if (!isValidDayKey(spec.anchorKey)) {
    return { ok: false, error: "Anchor date is not a valid date." }
  }
  if (!isValidDayKey(spec.untilKey)) {
    return { ok: false, error: "End date is not a valid date." }
  }

  const daysOfWeek = normalizeDaysOfWeek(spec.daysOfWeek)
  if (daysOfWeek.length === 0) {
    return { ok: false, error: "Select at least one day of the week." }
  }
  if (daysOfWeek.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return {
      ok: false,
      error: "Days of week must be between 0 (Sunday) and 6 (Saturday).",
    }
  }

  const rangeDays = daysBetween(spec.anchorKey, spec.untilKey)
  if (rangeDays <= 0) {
    return { ok: false, error: "End date must be after the anchor date." }
  }
  if (rangeDays > MAX_RANGE_DAYS) {
    return {
      ok: false,
      error: `Recurrence range cannot exceed ${MAX_RANGE_DAYS} days.`,
    }
  }

  const dates = expandRecurrenceDates({ ...spec, daysOfWeek })
  if (dates.length > MAX_OCCURRENCES) {
    return {
      ok: false,
      error: `Recurrence would generate more than ${MAX_OCCURRENCES} occurrences.`,
    }
  }

  return { ok: true }
}
