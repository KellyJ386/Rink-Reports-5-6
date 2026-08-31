import { describe, expect, it } from "vitest"

import { findOpenStartsForDay, type BlockedInterval } from "./find-slot"

const MIN = 60_000
// A synthetic day: open at t=0, close at t=17h (a 6am-11pm rink in minutes).
const OPEN = 0
const CLOSE = 17 * 60 * MIN

function block(startMin: number, endMin: number): BlockedInterval {
  return { startMs: startMin * MIN, endMs: endMin * MIN }
}

function findMinutes(overrides: Partial<Parameters<typeof findOpenStartsForDay>[0]>): number[] {
  return findOpenStartsForDay({
    openMs: OPEN,
    closeMs: CLOSE,
    blocked: [],
    durationMs: 60 * MIN,
    newBufferMs: 15 * MIN,
    stepMs: 30 * MIN,
    notBeforeMs: OPEN,
    limit: 100,
    ...overrides,
  }).map((ms) => ms / MIN)
}

describe("findOpenStartsForDay", () => {
  it("offers every step in an empty day, ice time fitting before close", () => {
    const starts = findMinutes({})
    expect(starts[0]).toBe(0)
    expect(starts[1]).toBe(30)
    // Last start where 60 min of ice still fits before close (buffer may
    // trail past close).
    expect(starts[starts.length - 1]).toBe(17 * 60 - 60)
  })

  it("excludes candidates whose ice or buffer collides with a booking's block", () => {
    // Booking 10:00-11:00 with a 15-min buffer blocks [600, 675).
    const starts = findMinutes({ blocked: [block(600, 675)] })
    // 8:30 + 60 + 15 ends 9:45, clear of the block: offered.
    expect(starts).toContain(510)
    // 9:00 (ends 10:00, buffer to 10:15) collides with the booking start.
    expect(starts).not.toContain(540)
    // Inside the booking: gone.
    expect(starts).not.toContain(600)
    expect(starts).not.toContain(630)
    // The block ends at 11:15; the grid's next step is 11:30.
    expect(starts).not.toContain(660)
    expect(starts).toContain(690)
  })

  it("a zero buffer allows back-to-back slots (included-in-rental facilities)", () => {
    const starts = findMinutes({ blocked: [block(600, 660)], newBufferMs: 0 })
    // Ice ends exactly when the booking starts: allowed.
    expect(starts).toContain(540)
    // And a slot starting exactly at the block's end: allowed.
    expect(starts).toContain(660)
  })

  it("respects notBefore by re-aligning to the step grid", () => {
    // "Now" is 10:10; the next grid step anchored at open is 10:30.
    const starts = findMinutes({ notBeforeMs: 610 * MIN })
    expect(starts[0]).toBe(630)
  })

  it("caps results at the limit, earliest first", () => {
    const starts = findMinutes({ limit: 3 })
    expect(starts).toEqual([0, 30, 60])
  })

  it("returns nothing when the duration cannot fit the window at all", () => {
    expect(findMinutes({ durationMs: 18 * 60 * MIN })).toEqual([])
  })
})
