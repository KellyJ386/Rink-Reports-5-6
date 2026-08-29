// Pure date-key arithmetic for the period navigator (prev/next buttons). No
// server-only imports — unit-tested directly.

import { addDaysToKey } from "@/lib/timezone"

import type { ReportPeriod } from "./get-report"

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0, 12)).getUTCDate()
}

function addMonthsToKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number)
  const targetMonthIndex = m - 1 + n
  const targetYear = y + Math.floor(targetMonthIndex / 12)
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12
  const lastDay = daysInMonth(targetYear, targetMonth)
  const pad = (v: number) => String(v).padStart(2, "0")
  return `${targetYear}-${pad(targetMonth + 1)}-${pad(Math.min(d, lastDay))}`
}

/**
 * Shifts an anchor date by one period in the given direction. For "year" this
 * shifts by 12 CALENDAR months, not 1 calendar year — deliberately, so it
 * works identically for a fiscal-year facility: any 12-month jump from a date
 * inside one fiscal year always lands inside the adjacent one, regardless of
 * where facilities.fiscal_year_start_month falls. report_period_bounds()
 * resolves the actual window server-side; this only has to land the anchor in
 * the right neighboring period.
 */
export function shiftAnchor(anchorDate: string, period: ReportPeriod, direction: 1 | -1): string {
  switch (period) {
    case "day":
      return addDaysToKey(anchorDate, direction)
    case "week":
      return addDaysToKey(anchorDate, direction * 7)
    case "month":
      return addMonthsToKey(anchorDate, direction)
    case "year":
      return addMonthsToKey(anchorDate, direction * 12)
  }
}
