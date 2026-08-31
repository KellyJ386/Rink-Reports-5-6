import { describe, expect, it } from "vitest"

import { planCutsForRinkDay, type PlannableBooking } from "./resurface-plan"

const MIN = 60_000

function booking(
  startMin: number,
  endMin: number,
  opts: { bufferMin?: number; isResurface?: boolean } = {},
): PlannableBooking {
  return {
    startMs: startMin * MIN,
    endMs: endMin * MIN,
    blocksUntilMs: (endMin + (opts.bufferMin ?? 0)) * MIN,
    isResurface: opts.isResurface ?? false,
  }
}

function planMinutes(bookings: PlannableBooking[], cutMin = 10): Array<[number, number]> {
  return planCutsForRinkDay(bookings, cutMin * MIN).map((c) => [c.startMs / MIN, c.endMs / MIN])
}

describe("planCutsForRinkDay", () => {
  it("proposes a cut at the start of each fitting gap between rentals", () => {
    const plan = planMinutes([booking(600, 660), booking(675, 735), booking(800, 860)])
    // 660-675 gap: 15 min, a 10-min cut fits at 660. 735-800: fits at 735.
    expect(plan).toEqual([
      [660, 670],
      [735, 745],
    ])
  })

  it("never plans before the first or after the last booking", () => {
    expect(planMinutes([booking(600, 660)])).toEqual([])
  })

  it("skips gaps too small for the cut", () => {
    // Back-to-back (included-in-rental facilities) and a 5-minute gap: no cut.
    expect(planMinutes([booking(600, 660), booking(660, 720), booking(725, 785)])).toEqual([])
  })

  it("measures the gap from blocks_until, not ends_at (appended buffers)", () => {
    // 60-min rental with a 15-min buffer blocks to 675; next starts 700.
    // Only 25 minutes remain after the buffer — a 10-min cut fits at 675.
    const plan = planMinutes([booking(600, 660, { bufferMin: 15 }), booking(700, 760)])
    expect(plan).toEqual([[675, 685]])
    // With a 30-minute cut it would not fit.
    expect(planMinutes([booking(600, 660, { bufferMin: 15 }), booking(700, 760)], 30)).toEqual([])
  })

  it("skips gaps that touch an existing resurface booking", () => {
    const plan = planMinutes([
      booking(600, 660),
      booking(665, 675, { isResurface: true }),
      booking(700, 760),
    ])
    expect(plan).toEqual([])
  })

  it("handles unsorted input", () => {
    const plan = planMinutes([booking(800, 860), booking(600, 660), booking(675, 735)])
    expect(plan).toEqual([
      [660, 670],
      [735, 745],
    ])
  })
})
