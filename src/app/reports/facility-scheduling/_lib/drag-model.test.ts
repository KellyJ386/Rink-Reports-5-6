import { describe, expect, it } from "vitest"

import {
  applyMove,
  applyResize,
  dragAxis,
  dragCreateRange,
  passesDragThreshold,
  pixelsToMinutes,
  snapMinute,
} from "./drag-model"

const EXTENT = { startMinute: 6 * 60, endMinute: 23 * 60 }

describe("pixelsToMinutes", () => {
  it("maps pixels proportionally to the rendered span", () => {
    // 17h span over 1020px -> 1px = 1 minute.
    expect(pixelsToMinutes(60, 1020, EXTENT)).toBe(60)
    expect(pixelsToMinutes(-30, 1020, EXTENT)).toBe(-30)
  })

  it("degrades to zero on a zero-height grid", () => {
    expect(pixelsToMinutes(100, 0, EXTENT)).toBe(0)
  })
})

describe("snapMinute", () => {
  it("rounds to the nearest step, both directions", () => {
    expect(snapMinute(614, 30)).toBe(600)
    expect(snapMinute(616, 30)).toBe(630)
    expect(snapMinute(600, 0)).toBe(600)
  })
})

describe("applyMove", () => {
  it("keeps duration and snaps the new start", () => {
    expect(applyMove(600, 660, 44, 30)).toEqual({ startMinute: 630, endMinute: 690 })
  })

  it("clamps so the booking never leaves the day", () => {
    expect(applyMove(600, 660, -2000, 30)).toEqual({ startMinute: 0, endMinute: 60 })
    expect(applyMove(600, 660, 2000, 30)).toEqual({ startMinute: 1380, endMinute: 1440 })
  })
})

describe("applyResize", () => {
  it("moves only the end edge, snapped", () => {
    expect(applyResize(600, 660, 47, 30)).toEqual({ startMinute: 600, endMinute: 720 })
  })

  it("never collapses below one step or past midnight", () => {
    expect(applyResize(600, 660, -2000, 30)).toEqual({ startMinute: 600, endMinute: 630 })
    expect(applyResize(600, 660, 2000, 30)).toEqual({ startMinute: 600, endMinute: 1440 })
  })
})

describe("passesDragThreshold", () => {
  it("distinguishes a click from a drag", () => {
    expect(passesDragThreshold(2, 2)).toBe(false)
    expect(passesDragThreshold(0, 6)).toBe(true)
  })
})

describe("dragAxis", () => {
  it("locks to the dominant direction, ties going to time", () => {
    expect(dragAxis(40, 10)).toBe("x")
    expect(dragAxis(-40, 10)).toBe("x")
    expect(dragAxis(10, 40)).toBe("y")
    expect(dragAxis(10, -40)).toBe("y")
    expect(dragAxis(25, 25)).toBe("y")
  })
})

describe("dragCreateRange", () => {
  it("selects the snapped span between anchor and pointer, either direction", () => {
    expect(dragCreateRange(600, 700, 30, EXTENT)).toEqual({ startMinute: 600, endMinute: 690 })
    expect(dragCreateRange(700, 590, 30, EXTENT)).toEqual({ startMinute: 600, endMinute: 690 })
  })

  it("is never shorter than one step and stays inside the extent", () => {
    expect(dragCreateRange(600, 601, 30, EXTENT)).toEqual({ startMinute: 600, endMinute: 630 })
    expect(dragCreateRange(300, 200, 30, EXTENT)).toEqual({ startMinute: 360, endMinute: 390 })
  })
})
