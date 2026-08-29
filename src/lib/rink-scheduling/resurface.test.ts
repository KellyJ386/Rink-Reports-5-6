import { describe, expect, it } from "vitest"

import { canTransition, resolveResurfaceMinutes } from "./resurface"

describe("resolveResurfaceMinutes", () => {
  it("per-sheet override outranks the facility default", () => {
    expect(
      resolveResurfaceMinutes({ facilityDefaultMinutes: 15, rinkOverrideMinutes: 25 }),
    ).toBe(25)
    expect(
      resolveResurfaceMinutes({ facilityDefaultMinutes: 15, rinkOverrideMinutes: null }),
    ).toBe(15)
  })

  it("clamps into the 1-120 range and survives missing settings", () => {
    expect(resolveResurfaceMinutes({ facilityDefaultMinutes: 500, rinkOverrideMinutes: null })).toBe(120)
    expect(resolveResurfaceMinutes({ facilityDefaultMinutes: 0, rinkOverrideMinutes: null })).toBe(1)
    expect(resolveResurfaceMinutes({ facilityDefaultMinutes: null, rinkOverrideMinutes: undefined })).toBe(15)
    expect(resolveResurfaceMinutes({ facilityDefaultMinutes: Number.NaN, rinkOverrideMinutes: null })).toBe(15)
  })
})

describe("canTransition", () => {
  it("allows every change of state and refuses no-ops", () => {
    expect(canTransition("scheduled", "completed")).toBe(true)
    expect(canTransition("scheduled", "skipped")).toBe(true)
    expect(canTransition("completed", "scheduled")).toBe(true)
    expect(canTransition("skipped", "scheduled")).toBe(true)
    expect(canTransition("completed", "skipped")).toBe(true)
    expect(canTransition("scheduled", "scheduled")).toBe(false)
  })
})
