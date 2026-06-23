import { describe, expect, it } from "vitest"

import { parseCaliperReading } from "./caliper"

describe("parseCaliperReading", () => {
  it("parses a plain decimal", () => {
    expect(parseCaliperReading("12.34")).toBe(12.34)
  })

  it("strips a leading sign and zero padding", () => {
    expect(parseCaliperReading("+001.27\r\n")).toBe(1.27)
  })

  it("ignores a trailing unit suffix", () => {
    expect(parseCaliperReading("12.34mm")).toBe(12.34)
  })

  it("normalizes a comma decimal separator", () => {
    expect(parseCaliperReading("0,50")).toBe(0.5)
  })

  it("parses negative readings", () => {
    expect(parseCaliperReading("-0.05")).toBe(-0.05)
  })

  it("takes the first number when several are present", () => {
    expect(parseCaliperReading("1.50 2.50")).toBe(1.5)
  })

  it("returns null for non-numeric / keepalive frames", () => {
    expect(parseCaliperReading("OK")).toBeNull()
    expect(parseCaliperReading("")).toBeNull()
    expect(parseCaliperReading("\r\n")).toBeNull()
  })
})
