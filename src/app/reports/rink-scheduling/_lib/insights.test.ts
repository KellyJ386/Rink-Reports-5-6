import { describe, expect, it } from "vitest"

import {
  agingReport,
  bookingTypeMix,
  computeUtilization,
  openMinutesInRange,
  revenueByCustomer,
  revenueByMonth,
  type InsightBooking,
  type InsightInvoice,
} from "./insights"
import type { ExceptionRow, HoursRow } from "./grid-model"

const NY = "America/New_York"

// Open 06:00–23:00 every day = 1020 min/day.
const HOURS: HoursRow[] = Array.from({ length: 7 }, (_, dow) => ({
  day_of_week: dow,
  open_time: "06:00",
  close_time: "23:00",
  is_closed: false,
}))

function booking(over: Partial<InsightBooking>): InsightBooking {
  return {
    id: "b1",
    rink_id: "r1",
    starts_at: "2026-09-07T21:00:00.000Z", // 5pm EDT
    ends_at: "2026-09-07T23:00:00.000Z", // 7pm EDT
    status: "confirmed",
    booking_type_id: "t1",
    rate_snapshot_prime: false,
    computed_amount: 300,
    ...over,
  }
}

describe("openMinutesInRange", () => {
  it("sums the posted window over the range", () => {
    expect(openMinutesInRange(HOURS, [], "2026-09-07", "2026-09-13")).toBe(7 * 1020)
  })

  it("a closed exception removes the day; special hours replace it", () => {
    const exceptions: ExceptionRow[] = [
      { exception_date: "2026-09-08", open_time: null, close_time: null, is_closed: true, label: "Holiday" },
      { exception_date: "2026-09-09", open_time: "10:00", close_time: "14:00", is_closed: false, label: "Maintenance" },
    ]
    expect(openMinutesInRange(HOURS, exceptions, "2026-09-07", "2026-09-09")).toBe(
      1020 + 0 + 240,
    )
  })

  it("a window wrapping midnight counts both segments", () => {
    const late: HoursRow[] = [
      { day_of_week: 1, open_time: "22:00", close_time: "02:00", is_closed: false },
    ]
    // Monday 2026-09-07: 22:00->24:00 plus 00:00->02:00.
    expect(openMinutesInRange(late, [], "2026-09-07", "2026-09-07")).toBe(240)
  })
})

describe("computeUtilization", () => {
  it("attributes booked minutes to the right rink and prime bucket", () => {
    const { perRink, total } = computeUtilization({
      bookings: [
        booking({ id: "a", rate_snapshot_prime: true }), // 120 min prime, r1
        booking({
          id: "b",
          rink_id: "r2",
          starts_at: "2026-09-08T14:00:00.000Z", // 10am EDT
          ends_at: "2026-09-08T15:30:00.000Z",
          rate_snapshot_prime: false,
        }), // 90 min non-prime, r2
        booking({ id: "c", rate_snapshot_prime: null }), // 120 blended, r1
        booking({ id: "d", status: "cancelled" }), // ignored
      ],
      hours: HOURS,
      exceptions: [],
      rinkIds: ["r1", "r2"],
      fromKey: "2026-09-07",
      toKey: "2026-09-13",
      timeZone: NY,
    })

    const r1 = perRink.find((r) => r.rinkId === "r1")!
    const r2 = perRink.find((r) => r.rinkId === "r2")!
    expect(r1.bookedMinutes).toBe(240)
    expect(r1.primeMinutes).toBe(120)
    expect(r1.unclassifiedMinutes).toBe(120)
    expect(r2.bookedMinutes).toBe(90)
    expect(r2.nonPrimeMinutes).toBe(90)
    expect(total.bookedMinutes).toBe(330)
    // Two rinks, each open 7 x 1020.
    expect(total.openMinutes).toBe(2 * 7 * 1020)
    expect(total.utilizationPct).toBeCloseTo((330 / (2 * 7 * 1020)) * 100, 5)
  })

  it("clips a straddling booking to its in-range minutes", () => {
    const { perRink } = computeUtilization({
      bookings: [
        booking({
          // 11pm EDT Sep 6 -> 1am EDT Sep 7: only the 60 min after local
          // midnight fall inside the range.
          starts_at: "2026-09-07T03:00:00.000Z",
          ends_at: "2026-09-07T05:00:00.000Z",
        }),
      ],
      hours: HOURS,
      exceptions: [],
      rinkIds: ["r1"],
      fromKey: "2026-09-07",
      toKey: "2026-09-07",
      timeZone: NY,
    })
    // 03:00Z–05:00Z is 11pm–1am EDT; Sep 7 local sees 00:00–01:00 = 60 min.
    expect(perRink[0].bookedMinutes).toBe(60)
  })

  it("no posted hours -> pct null, not Infinity", () => {
    const { perRink } = computeUtilization({
      bookings: [booking({})],
      hours: [],
      exceptions: [],
      rinkIds: ["r1"],
      fromKey: "2026-09-07",
      toKey: "2026-09-07",
      timeZone: NY,
    })
    expect(perRink[0].utilizationPct).toBeNull()
    expect(perRink[0].bookedMinutes).toBe(120)
  })
})

function invoice(over: Partial<InsightInvoice>): InsightInvoice {
  return {
    status: "sent",
    issue_date: "2026-08-05",
    due_date: "2026-09-04",
    total: 500,
    amount_paid: 0,
    customer_id: "c1",
    ...over,
  }
}

describe("revenueByMonth", () => {
  it("aggregates issued invoices per issue month, zero-filling gaps", () => {
    const rows = revenueByMonth(
      [
        invoice({ total: 500, amount_paid: 200 }),
        invoice({ issue_date: "2026-08-20", total: 250, amount_paid: 250, status: "paid" }),
        invoice({ issue_date: "2026-06-01", total: 999 }), // before window
        invoice({ issue_date: "2026-08-02", status: "draft", total: 100 }), // not issued
        invoice({ issue_date: "2026-08-02", status: "void", total: 100 }), // not revenue
      ],
      "2026-07",
      "2026-09",
    )
    expect(rows.map((r) => r.monthKey)).toEqual(["2026-07", "2026-08", "2026-09"])
    expect(rows[0]).toEqual({ monthKey: "2026-07", invoicedCents: 0, collectedCents: 0 })
    expect(rows[1].invoicedCents).toBe(75000)
    expect(rows[1].collectedCents).toBe(45000)
    expect(rows[2].invoicedCents).toBe(0)
  })

  it("crosses a year boundary", () => {
    const rows = revenueByMonth([], "2026-11", "2027-02")
    expect(rows.map((r) => r.monthKey)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"])
  })
})

describe("revenueByCustomer", () => {
  it("ranks by invoiced total and tracks the open share", () => {
    const rows = revenueByCustomer([
      invoice({ customer_id: "small", total: 100, amount_paid: 100, status: "paid" }),
      invoice({ customer_id: "big", total: 900, amount_paid: 400, status: "partially_paid" }),
      invoice({ customer_id: "big", total: 100 }),
      invoice({ customer_id: "void", total: 5000, status: "void" }),
    ])
    expect(rows.map((r) => r.customerId)).toEqual(["big", "small"])
    expect(rows[0].invoicedCents).toBe(100000)
    expect(rows[0].openCents).toBe(60000)
    expect(rows[1].openCents).toBe(0)
  })
})

describe("agingReport", () => {
  it("buckets open balances by days past due, facility-local today", () => {
    const report = agingReport(
      [
        invoice({ due_date: "2026-09-10", total: 100 }), // not yet due -> current
        invoice({ due_date: "2026-08-27", total: 200 }), // 1 day late
        invoice({ due_date: "2026-07-15", total: 300, amount_paid: 100, status: "partially_paid" }), // 44 late, 200 open
        invoice({ due_date: "2026-06-10", total: 400 }), // 79 late
        invoice({ due_date: "2025-12-01", total: 800 }), // 270 late
        invoice({ due_date: "2026-01-01", total: 999, amount_paid: 999, status: "paid" }), // settled
        invoice({ due_date: "2026-01-01", total: 999, status: "draft" }), // never issued
      ],
      "2026-08-28",
    )
    expect(report.currentCents).toBe(10000)
    expect(report.d1to30Cents).toBe(20000)
    expect(report.d31to60Cents).toBe(20000)
    expect(report.d61to90Cents).toBe(40000)
    expect(report.d90PlusCents).toBe(80000)
    expect(report.totalOpenCents).toBe(170000)
  })
})

describe("bookingTypeMix", () => {
  it("sums minutes and quoted value per type, unpriced contributing time only", () => {
    const rows = bookingTypeMix(
      [
        booking({ id: "a", booking_type_id: "hockey", computed_amount: 300 }),
        booking({ id: "b", booking_type_id: "hockey", computed_amount: null }),
        booking({
          id: "c",
          booking_type_id: "skate",
          starts_at: "2026-09-08T14:00:00.000Z",
          ends_at: "2026-09-08T15:00:00.000Z",
          computed_amount: 100,
        }),
        booking({ id: "d", booking_type_id: "hockey", status: "cancelled" }),
      ],
      { fromKey: "2026-09-07", toKey: "2026-09-13", timeZone: NY },
    )
    expect(rows[0]).toEqual({ bookingTypeId: "hockey", minutes: 240, quotedCents: 30000 })
    expect(rows[1]).toEqual({ bookingTypeId: "skate", minutes: 60, quotedCents: 10000 })
  })
})
