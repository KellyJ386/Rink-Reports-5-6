import { describe, expect, it } from "vitest"

import { resolveBufferMinutes } from "./buffer"

describe("resolveBufferMinutes", () => {
  it("per-sheet override outranks the facility default", () => {
    expect(
      resolveBufferMinutes({ facilityDefaultMinutes: 15, rinkOverrideMinutes: 10, includedInRental: false }),
    ).toBe(10)
    expect(
      resolveBufferMinutes({ facilityDefaultMinutes: 15, rinkOverrideMinutes: null, includedInRental: false }),
    ).toBe(15)
  })

  it("includedInRental forces zero regardless of any configured minutes", () => {
    expect(
      resolveBufferMinutes({ facilityDefaultMinutes: 15, rinkOverrideMinutes: 10, includedInRental: true }),
    ).toBe(0)
    expect(
      resolveBufferMinutes({ facilityDefaultMinutes: null, rinkOverrideMinutes: null, includedInRental: true }),
    ).toBe(0)
  })

  it("a zero override is honored, not treated as unset", () => {
    expect(
      resolveBufferMinutes({ facilityDefaultMinutes: 15, rinkOverrideMinutes: 0, includedInRental: false }),
    ).toBe(0)
  })

  it("clamps into the 0-120 range and survives missing settings", () => {
    expect(resolveBufferMinutes({ facilityDefaultMinutes: 500, rinkOverrideMinutes: null, includedInRental: false })).toBe(120)
    expect(resolveBufferMinutes({ facilityDefaultMinutes: -5, rinkOverrideMinutes: null, includedInRental: false })).toBe(0)
    expect(resolveBufferMinutes({ facilityDefaultMinutes: null, rinkOverrideMinutes: undefined, includedInRental: false })).toBe(15)
    expect(resolveBufferMinutes({ facilityDefaultMinutes: Number.NaN, rinkOverrideMinutes: null, includedInRental: null })).toBe(15)
  })
})
