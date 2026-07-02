import { describe, expect, it } from "vitest"

import {
  cToF,
  fToC,
  galToL,
  galToPct,
  isTempUnit,
  lToGal,
  pctToGal,
  roundTemp,
  roundVolume,
  tempUnitLabel,
  waterUsageUnitLabel,
} from "./units"

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

describe("galToL / lToGal", () => {
  it("converts using the US liquid gallon factor", () => {
    expect(galToL(1)).toBeCloseTo(3.785411784, 9)
    expect(lToGal(3.785411784)).toBeCloseTo(1, 9)
  })

  it("round-trips within floating-point tolerance", () => {
    for (const gal of [0, 5, 12.5, 100]) {
      expect(lToGal(galToL(gal))).toBeCloseTo(gal, 10)
    }
  })
})

describe("galToPct / pctToGal", () => {
  it("converts gallons to a percentage of tank capacity and back", () => {
    expect(galToPct(25, 100)).toBe(25)
    expect(pctToGal(25, 100)).toBe(25)
    expect(galToPct(30, 120)).toBe(25)
  })

  it("returns null when tank capacity is missing or non-positive", () => {
    expect(galToPct(25, null)).toBeNull()
    expect(galToPct(25, 0)).toBeNull()
    expect(galToPct(25, -10)).toBeNull()
    expect(pctToGal(25, null)).toBeNull()
    expect(pctToGal(25, 0)).toBeNull()
  })
})

describe("roundVolume", () => {
  it("rounds to two decimal places", () => {
    expect(roundVolume(12.3456)).toBe(12.35)
    expect(roundVolume(12.344)).toBe(12.34)
    expect(roundVolume(10)).toBe(10)
  })
})

describe("waterUsageUnitLabel", () => {
  it("maps the canonical units to display labels", () => {
    expect(waterUsageUnitLabel("gal")).toBe("gal")
    expect(waterUsageUnitLabel("L")).toBe("L")
    expect(waterUsageUnitLabel("pct")).toBe("% of tank")
  })
})
