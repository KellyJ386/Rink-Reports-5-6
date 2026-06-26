import { describe, expect, it } from "vitest"

import {
  applyGridDelta,
  isRealMove,
  pixelDeltaToGridDelta,
  type GridBounds,
} from "./keyboard-move"

const BOUNDS: GridBounds = { dayCount: 7, hourStart: 6, hourEnd: 23 }

describe("pixelDeltaToGridDelta", () => {
  const geom = { colWidth: 120, rowH: 30 }

  it("rounds horizontal pixels to whole day columns", () => {
    expect(pixelDeltaToGridDelta({ x: 120, y: 0 }, geom)).toEqual({
      days: 1,
      hours: 0,
    })
    expect(pixelDeltaToGridDelta({ x: -240, y: 0 }, geom)).toEqual({
      days: -2,
      hours: 0,
    })
    // 70px ≈ 0.58 col → rounds to 1
    expect(pixelDeltaToGridDelta({ x: 70, y: 0 }, geom).days).toBe(1)
  })

  it("snaps vertical pixels to the nearest 15 minutes", () => {
    // 30px = 1 row = 1 hour
    expect(pixelDeltaToGridDelta({ x: 0, y: 30 }, geom).hours).toBe(1)
    // 15px = 0.5 row = 0.5h
    expect(pixelDeltaToGridDelta({ x: 0, y: 15 }, geom).hours).toBe(0.5)
    // 8px ≈ 0.27h → snaps to 0.25h
    expect(pixelDeltaToGridDelta({ x: 0, y: 8 }, geom).hours).toBe(0.25)
  })

  it("never divides by a zero column width / row height", () => {
    expect(
      pixelDeltaToGridDelta({ x: 100, y: 100 }, { colWidth: 0, rowH: 0 }),
    ).toEqual({ days: 0, hours: 0 })
  })
})

describe("applyGridDelta", () => {
  it("moves a block across days and hours, preserving duration", () => {
    const next = applyGridDelta(
      { dayIndex: 1, startHour: 9, endHour: 13 },
      { days: 2, hours: 1 },
      BOUNDS,
    )
    expect(next).toEqual({ dayIndex: 3, startHour: 10, endHour: 14 })
  })

  it("clamps the day index to the visible window", () => {
    expect(
      applyGridDelta(
        { dayIndex: 6, startHour: 9, endHour: 11 },
        { days: 3, hours: 0 },
        BOUNDS,
      ).dayIndex,
    ).toBe(6)
    expect(
      applyGridDelta(
        { dayIndex: 0, startHour: 9, endHour: 11 },
        { days: -3, hours: 0 },
        BOUNDS,
      ).dayIndex,
    ).toBe(0)
  })

  it("clamps so the block END never spills past hourEnd", () => {
    // 4h block dragged way down: start clamps to 23 - 4 = 19
    const next = applyGridDelta(
      { dayIndex: 0, startHour: 18, endHour: 22 },
      { days: 0, hours: 10 },
      BOUNDS,
    )
    expect(next.startHour).toBe(19)
    expect(next.endHour).toBe(23)
  })

  it("clamps so the block START never precedes hourStart", () => {
    const next = applyGridDelta(
      { dayIndex: 0, startHour: 7, endHour: 9 },
      { days: 0, hours: -10 },
      BOUNDS,
    )
    expect(next.startHour).toBe(6)
    expect(next.endHour).toBe(8)
  })

  it("handles a single-column (day view) window", () => {
    const next = applyGridDelta(
      { dayIndex: 0, startHour: 9, endHour: 10 },
      { days: 5, hours: 0 },
      { dayCount: 1, hourStart: 6, hourEnd: 23 },
    )
    expect(next.dayIndex).toBe(0)
  })
})

describe("isRealMove", () => {
  const base = { dayIndex: 2, startHour: 9, endHour: 12 }
  it("is false for a no-op", () => {
    expect(isRealMove(base, { ...base })).toBe(false)
  })
  it("is true when the day changes", () => {
    expect(isRealMove(base, { ...base, dayIndex: 3 })).toBe(true)
  })
  it("is true when the start hour changes", () => {
    expect(isRealMove(base, { ...base, startHour: 9.25, endHour: 12.25 })).toBe(
      true,
    )
  })
})
