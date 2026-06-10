import { describe, expect, it } from "vitest"

import { cToF, fToC, isTempUnit, roundTemp, tempUnitLabel } from "./units"

describe("isTempUnit", () => {
  it("accepts F/C with or without the degree sign, any case, padded", () => {
    for (const unit of ["F", "C", "°F", "°C", "f", "c", " °f ", "  C  "]) {
      expect(isTempUnit(unit), unit).toBe(true)
    }
  })

  it("rejects non-temperature units and non-strings", () => {
    for (const unit of ["PSI", "ppm", "°K", "FC", "", "deg F"]) {
      expect(isTempUnit(unit), unit).toBe(false)
    }
    expect(isTempUnit(null)).toBe(false)
    expect(isTempUnit(undefined)).toBe(false)
  })
})

describe("fToC / cToF", () => {
  it("converts the fixed points", () => {
    expect(fToC(32)).toBe(0)
    expect(fToC(212)).toBe(100)
    expect(cToF(0)).toBe(32)
    expect(cToF(100)).toBe(212)
    expect(fToC(-40)).toBe(-40)
    expect(cToF(-40)).toBe(-40)
  })

  it("round-trips within floating-point tolerance", () => {
    for (const f of [-10, 0, 16, 72.5, 98.6]) {
      expect(cToF(fToC(f))).toBeCloseTo(f, 10)
    }
  })
})

describe("roundTemp", () => {
  it("rounds to one decimal place", () => {
    expect(roundTemp(72.449)).toBe(72.4)
    expect(roundTemp(72.45)).toBe(72.5)
    expect(roundTemp(-0.04)).toBe(-0)
    expect(roundTemp(10)).toBe(10)
  })
})

describe("tempUnitLabel", () => {
  it("maps the canonical units to display labels", () => {
    expect(tempUnitLabel("F")).toBe("°F")
    expect(tempUnitLabel("C")).toBe("°C")
  })
})
