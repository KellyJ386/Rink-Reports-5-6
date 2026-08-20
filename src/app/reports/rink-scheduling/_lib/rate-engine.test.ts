import { describe, expect, it } from "vitest"

import {
  describeSegment,
  primeRangesForDay,
  quoteBooking,
  resolveRateCard,
  type PrimeWindow,
  type RateCardLike,
} from "./rate-engine"

const TZ = "America/New_York"

const CARD: RateCardLike = {
  id: "card-1",
  name: "Standard Rates",
  effective_start: "2026-01-01",
  effective_end: null,
  is_default: true,
  hourly_rate_prime: 300,
  hourly_rate_nonprime: 200,
}

// Prime on Tuesdays 17:00-22:00 facility-local. 2026-09-01 is a Tuesday.
const WINDOWS: PrimeWindow[] = [
  { day_of_week: 2, start_time: "17:00", end_time: "22:00" },
]

/** Facility-local wall clock -> UTC ms. September is EDT (UTC-4). */
function edt(day: number, hour: number, minute = 0): number {
  return Date.UTC(2026, 8, day, hour + 4, minute)
}

function baseInput(startMs: number, endMs: number) {
  return {
    startsAtMs: startMs,
    endsAtMs: endMs,
    timeZone: TZ,
    cards: [CARD],
    windows: WINDOWS,
    overrides: [],
    bookingTypeId: "type-rental",
    isBillable: true,
  }
}

describe("resolveRateCard", () => {
  const older: RateCardLike = { ...CARD, id: "old", effective_start: "2025-01-01", effective_end: "2025-12-31" }
  const current: RateCardLike = { ...CARD, id: "cur", effective_start: "2026-01-01", effective_end: "2026-12-31" }
  const next: RateCardLike = { ...CARD, id: "nxt", effective_start: "2027-01-01", effective_end: null }

  it("picks the card covering the date", () => {
    expect(resolveRateCard([older, current, next], "2026-06-15")?.id).toBe("cur")
    expect(resolveRateCard([older, current, next], "2025-06-15")?.id).toBe("old")
    expect(resolveRateCard([older, current, next], "2027-06-15")?.id).toBe("nxt")
  })

  it("returns null when no card covers the date, rather than guessing", () => {
    expect(resolveRateCard([current], "2030-01-01")).toBeNull()
  })

  it("treats effective_end as inclusive", () => {
    expect(resolveRateCard([current], "2026-12-31")?.id).toBe("cur")
    expect(resolveRateCard([current], "2027-01-01")).toBeNull()
  })

  it("prefers a default card over a non-default one covering the same date", () => {
    const promo: RateCardLike = { ...CARD, id: "promo", is_default: false }
    expect(resolveRateCard([promo, current], "2026-06-15")?.id).toBe("cur")
  })

  it("lets an explicitly chosen customer card beat the default", () => {
    const promo: RateCardLike = { ...CARD, id: "promo", is_default: false }
    expect(resolveRateCard([promo, current], "2026-06-15", "promo")?.id).toBe("promo")
  })

  it("ignores a preferred card that does not cover the date", () => {
    expect(resolveRateCard([current], "2026-06-15", "nonexistent")?.id).toBe("cur")
  })
})

describe("primeRangesForDay", () => {
  it("returns only that weekday's windows", () => {
    expect(primeRangesForDay(WINDOWS, 2)).toEqual([{ start: 1020, end: 1320 }])
    expect(primeRangesForDay(WINDOWS, 3)).toEqual([])
  })

  it("merges overlapping windows so an hour cannot be counted twice", () => {
    const overlapping: PrimeWindow[] = [
      { day_of_week: 1, start_time: "17:00", end_time: "20:00" },
      { day_of_week: 1, start_time: "19:00", end_time: "22:00" },
    ]
    expect(primeRangesForDay(overlapping, 1)).toEqual([{ start: 1020, end: 1320 }])
  })

  it("drops malformed or zero-length windows instead of throwing", () => {
    const bad: PrimeWindow[] = [
      { day_of_week: 1, start_time: "nope", end_time: "20:00" },
      { day_of_week: 1, start_time: "20:00", end_time: "20:00" },
    ]
    expect(primeRangesForDay(bad, 1)).toEqual([])
  })
})

describe("quoteBooking", () => {
  it("prices a slot that is wholly prime", () => {
    // Tue 18:00-20:00, inside the 17:00-22:00 prime window.
    const q = quoteBooking(baseInput(edt(1, 18), edt(1, 20)))
    expect(q.problem).toBeNull()
    expect(q.totalHours).toBe(2)
    expect(q.segments).toHaveLength(1)
    expect(q.segments[0].isPrime).toBe(true)
    expect(q.totalAmount).toBe(600)
    expect(q.allPrime).toBe(true)
    expect(q.snapshotHourlyRate).toBe(300)
  })

  it("prices a slot that is wholly non-prime", () => {
    // Tue 06:00-08:00, nowhere near the evening window.
    const q = quoteBooking(baseInput(edt(1, 6), edt(1, 8)))
    expect(q.segments).toHaveLength(1)
    expect(q.segments[0].isPrime).toBe(false)
    expect(q.totalAmount).toBe(400)
    expect(q.allPrime).toBe(false)
    expect(q.snapshotHourlyRate).toBe(200)
  })

  it("SPLITS a slot straddling the prime boundary into two priced segments", () => {
    // Tue 16:00-18:00 crosses the 17:00 prime start: one hour each side.
    const q = quoteBooking(baseInput(edt(1, 16), edt(1, 18)))
    expect(q.segments).toHaveLength(2)
    expect(q.segments[0].isPrime).toBe(false)
    expect(q.segments[0].amount).toBe(200)
    expect(q.segments[1].isPrime).toBe(true)
    expect(q.segments[1].amount).toBe(300)
    expect(q.totalAmount).toBe(500)
    // No single rate honestly describes it, so nothing is snapshotted and the
    // blended total carries the price instead.
    expect(q.allPrime).toBeNull()
    expect(q.snapshotHourlyRate).toBeNull()
  })

  it("splits at the closing boundary too", () => {
    // Tue 21:00-23:00 crosses the 22:00 prime end.
    const q = quoteBooking(baseInput(edt(1, 21), edt(1, 23)))
    expect(q.segments.map((s) => s.isPrime)).toEqual([true, false])
    expect(q.totalAmount).toBe(500)
  })

  it("applies a booking-type override in place of the card's rates", () => {
    const q = quoteBooking({
      ...baseInput(edt(1, 18), edt(1, 20)),
      bookingTypeId: "type-internal",
      overrides: [
        {
          rate_card_id: "card-1",
          booking_type_id: "type-internal",
          hourly_rate_prime: 50,
          hourly_rate_nonprime: 25,
        },
      ],
    })
    expect(q.totalAmount).toBe(100)
    expect(q.snapshotHourlyRate).toBe(50)
  })

  it("supports a $0 internal type without treating it as unpriced", () => {
    const q = quoteBooking({
      ...baseInput(edt(1, 18), edt(1, 20)),
      bookingTypeId: "type-internal",
      overrides: [
        {
          rate_card_id: "card-1",
          booking_type_id: "type-internal",
          hourly_rate_prime: 0,
          hourly_rate_nonprime: 0,
        },
      ],
    })
    expect(q.totalAmount).toBe(0)
    expect(q.problem).toBeNull()
    expect(q.segments).toHaveLength(1)
  })

  it("does not price a non-billable booking at all", () => {
    // A Maintenance Block occupies ice but never reaches an invoice.
    const q = quoteBooking({ ...baseInput(edt(1, 6), edt(1, 8)), isBillable: false })
    expect(q.totalAmount).toBe(0)
    expect(q.segments).toHaveLength(0)
    expect(q.totalHours).toBe(2)
    expect(q.problem).toBeNull()
  })

  it("reports a missing rate card instead of silently pricing at zero", () => {
    const q = quoteBooking({
      ...baseInput(edt(1, 18), edt(1, 20)),
      cards: [{ ...CARD, effective_start: "2030-01-01" }],
    })
    expect(q.totalAmount).toBe(0)
    expect(q.problem).toMatch(/no rate card/i)
  })

  it("rejects a backwards time range", () => {
    const q = quoteBooking(baseInput(edt(1, 20), edt(1, 18)))
    expect(q.problem).toMatch(/after the start/i)
  })

  it("handles a booking crossing midnight, pricing each local day's windows", () => {
    // Tue 23:00 -> Wed 01:00. Both hours are outside Tuesday's prime window,
    // and Wednesday has no window at all.
    const q = quoteBooking(baseInput(edt(1, 23), edt(2, 1)))
    expect(q.totalHours).toBe(2)
    expect(q.segments.every((s) => !s.isPrime)).toBe(true)
    expect(q.totalAmount).toBe(400)
  })

  it("charges the right rate on each side of a rate-card rollover", () => {
    // The same weekly slot before and after a mid-series card change: each
    // occurrence resolves against the card effective on ITS OWN date.
    const oldCard: RateCardLike = {
      ...CARD,
      id: "old",
      effective_start: "2026-01-01",
      effective_end: "2026-09-01",
      hourly_rate_prime: 300,
    }
    const newCard: RateCardLike = {
      ...CARD,
      id: "new",
      effective_start: "2026-09-02",
      effective_end: null,
      hourly_rate_prime: 400,
    }
    const cards = [oldCard, newCard]

    // Tue 2026-09-01, prime — still the old card.
    const before = quoteBooking({ ...baseInput(edt(1, 18), edt(1, 20)), cards })
    expect(before.rateCardId).toBe("old")
    expect(before.totalAmount).toBe(600)

    // Tue 2026-09-08, prime — the new card.
    const after = quoteBooking({ ...baseInput(edt(8, 18), edt(8, 20)), cards })
    expect(after.rateCardId).toBe("new")
    expect(after.totalAmount).toBe(800)
  })

  it("prices a half-hour slot without a rounding drift", () => {
    const q = quoteBooking(baseInput(edt(1, 18), edt(1, 18, 30)))
    expect(q.totalHours).toBe(0.5)
    expect(q.totalAmount).toBe(150)
  })

  it("keeps a straddling total equal to the sum of its parts", () => {
    const q = quoteBooking(baseInput(edt(1, 16, 30), edt(1, 17, 30)))
    const summed = q.segments.reduce((s, seg) => s + seg.amount, 0)
    expect(q.totalAmount).toBeCloseTo(summed, 2)
  })

  it("treats a slot ending exactly at the prime start as fully non-prime", () => {
    // Half-open: 17:00 belongs to prime, so 15:00-17:00 must not pick any up.
    const q = quoteBooking(baseInput(edt(1, 15), edt(1, 17)))
    expect(q.segments).toHaveLength(1)
    expect(q.segments[0].isPrime).toBe(false)
    expect(q.totalAmount).toBe(400)
  })

  it("treats a slot starting exactly at the prime start as fully prime", () => {
    const q = quoteBooking(baseInput(edt(1, 17), edt(1, 19)))
    expect(q.segments).toHaveLength(1)
    expect(q.segments[0].isPrime).toBe(true)
    expect(q.totalAmount).toBe(600)
  })
})

describe("describeSegment", () => {
  it("reads as the arithmetic it is", () => {
    const q = quoteBooking(baseInput(edt(1, 18), edt(1, 19, 30)))
    expect(describeSegment(q.segments[0])).toBe("1.5 h × $300.00 = $450.00")
  })
})
