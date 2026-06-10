import { describe, expect, it } from "vitest"

import { asShiftView, isShiftStatus, SHIFT_VIEWS } from "./types"

describe("isShiftStatus", () => {
  it("accepts only the three known statuses", () => {
    expect(isShiftStatus("draft")).toBe(true)
    expect(isShiftStatus("published")).toBe(true)
    expect(isShiftStatus("cancelled")).toBe(true)
  })

  it("rejects unknown and near-miss values", () => {
    for (const v of ["", "Draft", "applied", "archived", "publish"]) {
      expect(isShiftStatus(v), v).toBe(false)
    }
  })
})

describe("asShiftView", () => {
  it("passes through every valid view", () => {
    for (const v of SHIFT_VIEWS) {
      expect(asShiftView(v)).toBe(v)
    }
  })

  it("falls back to week for unknown or missing params", () => {
    expect(asShiftView(undefined)).toBe("week")
    expect(asShiftView("")).toBe("week")
    expect(asShiftView("yearly")).toBe("week")
    expect(asShiftView("Week")).toBe("week")
  })
})
