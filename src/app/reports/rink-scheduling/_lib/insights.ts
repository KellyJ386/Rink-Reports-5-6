// Pure computation for the Insights page: ice utilization, revenue, and A/R
// aging. Everything here is arithmetic over rows the page has already
// fetched — no client, no zone guessing (callers pass the facility's zone),
// so the whole surface is unit-testable.
//
// UTILIZATION is measured against the facility's operating hours: bookedMinutes
// counts every non-cancelled booked minute on the day (even outside the posted
// window — the coverage sweep flags those; hiding them here would make a
// midnight tournament read as unused ice), while openMinutes is the posted
// window. The ratio can therefore exceed 100%; the UI caps the bar, not the
// number.

import { addDaysToKey } from "@/lib/timezone"

import {
  bookingMinutesOnDay,
  resolveDayWindow,
  type ExceptionRow,
  type HoursRow,
} from "./grid-model"

export type InsightBooking = {
  id: string
  rink_id: string
  starts_at: string
  ends_at: string
  status: string
  booking_type_id: string
  /** true = all prime, false = all non-prime, null = blended or unpriced. */
  rate_snapshot_prime: boolean | null
  computed_amount: number | null
}

export type RinkUtilization = {
  rinkId: string
  bookedMinutes: number
  primeMinutes: number
  nonPrimeMinutes: number
  /** Blended-rate or unpriced bookings — real ice time, just not attributable
   *  to one side of the prime boundary without re-slicing. */
  unclassifiedMinutes: number
  openMinutes: number
  /** bookedMinutes / openMinutes, or null when the facility posted no hours. */
  utilizationPct: number | null
}

export type UtilizationInput = {
  bookings: InsightBooking[]
  hours: HoursRow[]
  exceptions: ExceptionRow[]
  rinkIds: string[]
  fromKey: string
  /** Inclusive. */
  toKey: string
  timeZone: string | null
}

/** Sum of the posted operating window over [fromKey..toKey], minutes. */
export function openMinutesInRange(
  hours: HoursRow[],
  exceptions: ExceptionRow[],
  fromKey: string,
  toKey: string,
): number {
  let total = 0
  for (let day = fromKey; day <= toKey; day = addDaysToKey(day, 1)) {
    const window = resolveDayWindow(day, hours, exceptions)
    if (window.isClosed) continue
    // A window that wraps midnight (22:00 -> 02:00) still describes one
    // day's worth of open ice; count both segments.
    total += window.wrapsMidnight
      ? 1440 - window.openMinute + window.closeMinute
      : window.closeMinute - window.openMinute
  }
  return total
}

export function computeUtilization(input: UtilizationInput): {
  perRink: RinkUtilization[]
  total: RinkUtilization
} {
  const open = openMinutesInRange(input.hours, input.exceptions, input.fromKey, input.toKey)

  const byRink = new Map<string, RinkUtilization>(
    input.rinkIds.map((rinkId) => [
      rinkId,
      {
        rinkId,
        bookedMinutes: 0,
        primeMinutes: 0,
        nonPrimeMinutes: 0,
        unclassifiedMinutes: 0,
        openMinutes: open,
        utilizationPct: null,
      },
    ]),
  )

  for (const booking of input.bookings) {
    if (booking.status === "cancelled") continue
    const rink = byRink.get(booking.rink_id)
    if (!rink) continue

    // Walk the days the range covers rather than trusting the booking's own
    // endpoints — a booking that straddles the range edge contributes only
    // its in-range minutes.
    for (let day = input.fromKey; day <= input.toKey; day = addDaysToKey(day, 1)) {
      const span = bookingMinutesOnDay(
        booking.starts_at,
        booking.ends_at,
        day,
        input.timeZone,
      )
      if (!span) continue
      const minutes = span.endMinute - span.startMinute
      rink.bookedMinutes += minutes
      if (booking.rate_snapshot_prime === true) rink.primeMinutes += minutes
      else if (booking.rate_snapshot_prime === false) rink.nonPrimeMinutes += minutes
      else rink.unclassifiedMinutes += minutes
    }
  }

  const perRink = [...byRink.values()]
  for (const r of perRink) {
    r.utilizationPct = r.openMinutes > 0 ? (r.bookedMinutes / r.openMinutes) * 100 : null
  }

  const total: RinkUtilization = {
    rinkId: "total",
    bookedMinutes: perRink.reduce((s, r) => s + r.bookedMinutes, 0),
    primeMinutes: perRink.reduce((s, r) => s + r.primeMinutes, 0),
    nonPrimeMinutes: perRink.reduce((s, r) => s + r.nonPrimeMinutes, 0),
    unclassifiedMinutes: perRink.reduce((s, r) => s + r.unclassifiedMinutes, 0),
    openMinutes: open * input.rinkIds.length,
    utilizationPct: null,
  }
  total.utilizationPct =
    total.openMinutes > 0 ? (total.bookedMinutes / total.openMinutes) * 100 : null

  return { perRink, total }
}

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------

export type InsightInvoice = {
  status: string
  /** YYYY-MM-DD. Facility-local by construction (chosen by the biller). */
  issue_date: string
  due_date: string
  total: number | string
  amount_paid: number | string
  customer_id: string
}

const cents = (v: number | string): number => {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

/** An invoice that represents revenue: issued and not void. */
const isIssued = (status: string): boolean =>
  status === "sent" || status === "partially_paid" || status === "paid"

export type MonthRevenue = {
  /** YYYY-MM. */
  monthKey: string
  invoicedCents: number
  collectedCents: number
}

/**
 * Invoiced and collected totals per issue month, oldest first, months with no
 * invoices included so a chart shows the gap rather than eliding it.
 */
export function revenueByMonth(
  invoices: InsightInvoice[],
  fromMonthKey: string,
  toMonthKey: string,
): MonthRevenue[] {
  const months: MonthRevenue[] = []
  const index = new Map<string, MonthRevenue>()
  let cursor = fromMonthKey
  for (let guard = 0; guard < 120 && cursor <= toMonthKey; guard++) {
    const row = { monthKey: cursor, invoicedCents: 0, collectedCents: 0 }
    months.push(row)
    index.set(cursor, row)
    const [y, m] = cursor.split("-").map(Number)
    cursor = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`
  }

  for (const inv of invoices) {
    if (!isIssued(inv.status)) continue
    const row = index.get(inv.issue_date.slice(0, 7))
    if (!row) continue
    row.invoicedCents += cents(inv.total)
    row.collectedCents += cents(inv.amount_paid)
  }
  return months
}

export type CustomerRevenue = {
  customerId: string
  invoicedCents: number
  openCents: number
}

/** Issued revenue per customer, largest first. */
export function revenueByCustomer(invoices: InsightInvoice[]): CustomerRevenue[] {
  const byCustomer = new Map<string, CustomerRevenue>()
  for (const inv of invoices) {
    if (!isIssued(inv.status)) continue
    let row = byCustomer.get(inv.customer_id)
    if (!row) {
      row = { customerId: inv.customer_id, invoicedCents: 0, openCents: 0 }
      byCustomer.set(inv.customer_id, row)
    }
    row.invoicedCents += cents(inv.total)
    row.openCents += Math.max(0, cents(inv.total) - cents(inv.amount_paid))
  }
  return [...byCustomer.values()].sort((a, b) => b.invoicedCents - a.invoicedCents)
}

// ---------------------------------------------------------------------------
// A/R aging
// ---------------------------------------------------------------------------

export type AgingBuckets = {
  currentCents: number
  d1to30Cents: number
  d31to60Cents: number
  d61to90Cents: number
  d90PlusCents: number
  totalOpenCents: number
}

/** Whole days from `fromKey` to `toKey`, parsed at UTC noon. */
function daysBetween(fromKey: string, toKey: string): number {
  const parse = (k: string): number | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k)
    if (!m) return null
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
  }
  const from = parse(fromKey)
  const to = parse(toKey)
  if (from === null || to === null) return 0
  return Math.round((to - from) / 86_400_000)
}

/**
 * Open balances bucketed by how far past due, todayKey facility-local.
 * "Current" is issued but not yet past due — owed, just not late.
 */
export function agingReport(invoices: InsightInvoice[], todayKey: string): AgingBuckets {
  const out: AgingBuckets = {
    currentCents: 0,
    d1to30Cents: 0,
    d31to60Cents: 0,
    d61to90Cents: 0,
    d90PlusCents: 0,
    totalOpenCents: 0,
  }
  for (const inv of invoices) {
    if (inv.status !== "sent" && inv.status !== "partially_paid") continue
    const open = cents(inv.total) - cents(inv.amount_paid)
    if (open <= 0) continue
    out.totalOpenCents += open
    const late = daysBetween(inv.due_date, todayKey)
    if (late < 1) out.currentCents += open
    else if (late <= 30) out.d1to30Cents += open
    else if (late <= 60) out.d31to60Cents += open
    else if (late <= 90) out.d61to90Cents += open
    else out.d90PlusCents += open
  }
  return out
}

// ---------------------------------------------------------------------------
// Booking-type mix
// ---------------------------------------------------------------------------

export type TypeMixRow = {
  bookingTypeId: string
  minutes: number
  /** Sum of quoted amounts, cents; unpriced bookings contribute time only. */
  quotedCents: number
}

/** Ice time and quoted value per booking type over already-filtered bookings,
 *  largest time first. Cancelled bookings are excluded. */
export function bookingTypeMix(
  bookings: InsightBooking[],
  range: { fromKey: string; toKey: string; timeZone: string | null },
): TypeMixRow[] {
  const byType = new Map<string, TypeMixRow>()
  for (const booking of bookings) {
    if (booking.status === "cancelled") continue
    let minutes = 0
    for (let day = range.fromKey; day <= range.toKey; day = addDaysToKey(day, 1)) {
      const span = bookingMinutesOnDay(
        booking.starts_at,
        booking.ends_at,
        day,
        range.timeZone,
      )
      if (span) minutes += span.endMinute - span.startMinute
    }
    if (minutes === 0) continue
    let row = byType.get(booking.booking_type_id)
    if (!row) {
      row = { bookingTypeId: booking.booking_type_id, minutes: 0, quotedCents: 0 }
      byType.set(booking.booking_type_id, row)
    }
    row.minutes += minutes
    if (booking.computed_amount !== null) row.quotedCents += cents(booking.computed_amount)
  }
  return [...byType.values()].sort((a, b) => b.minutes - a.minutes)
}
