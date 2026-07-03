import { describe, expect, it } from "vitest"

import {
  excerpt,
  severityBadgeVariant,
  severityLabel,
  severityPillClasses,
  sourceModuleLabel,
} from "./format"

describe("severityLabel", () => {
  it("maps known severities to display labels", () => {
    expect(severityLabel("info")).toBe("Info")
    expect(severityLabel("warn")).toBe("Warning")
    expect(severityLabel("high")).toBe("High")
    expect(severityLabel("critical")).toBe("Critical")
  })

  it("passes unknown values through", () => {
    expect(severityLabel("mystery")).toBe("mystery")
  })
})

describe("severityBadgeVariant", () => {
  it("maps each severity to a semantic Badge variant", () => {
    expect(severityBadgeVariant("critical")).toBe("destructive")
    expect(severityBadgeVariant("high")).toBe("error")
    expect(severityBadgeVariant("warn")).toBe("warning")
    expect(severityBadgeVariant("info")).toBe("info")
    expect(severityBadgeVariant("unknown")).toBe("info")
  })
})

describe("severityPillClasses", () => {
  it("uses semantic tokens only (no hardcoded palette classes)", () => {
    for (const sev of ["critical", "high", "warn", "info", "unknown"]) {
      const cls = severityPillClasses(sev)
      expect(cls).not.toMatch(/(red|orange|amber|blue)-\d/)
      expect(cls).toMatch(/bg-(destructive|warning|info)/)
    }
  })
})

describe("sourceModuleLabel", () => {
  it("maps known module keys and passes unknown keys through", () => {
    expect(sourceModuleLabel("air_quality")).toBe("Air Quality")
    expect(sourceModuleLabel("accident_reports")).toBe("Accident")
    expect(sourceModuleLabel("custom_module")).toBe("custom_module")
  })
})

describe("excerpt", () => {
  it("returns empty string for null", () => {
    expect(excerpt(null)).toBe("")
  })

  it("passes short strings through untouched", () => {
    expect(excerpt("short body")).toBe("short body")
  })

  it("truncates long strings with a trimmed ellipsis", () => {
    const out = excerpt("a".repeat(50), 10)
    expect(out).toBe(`${"a".repeat(10)}…`)
    expect(excerpt("word ".repeat(10), 12)).toBe("word word wo…")
  })
})
