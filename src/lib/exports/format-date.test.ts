import { describe, expect, it } from "vitest"

import { formatExportDate } from "./format-date"

// Build an ISO string from LOCAL components so assertions are timezone-stable:
// formatExportDate reads local getters, and we construct via the local Date
// ctor, so the round-trip is deterministic regardless of the runner's TZ.
const iso = new Date(2024, 0, 5, 9, 7).toISOString() // Jan 5 2024, 09:07 local

describe("formatExportDate", () => {
  it("returns an empty string for null/undefined/empty input", () => {
    expect(formatExportDate(null, "MM/DD/YYYY")).toBe("")
    expect(formatExportDate(undefined, "MM/DD/YYYY")).toBe("")
    expect(formatExportDate("", "MM/DD/YYYY")).toBe("")
  })

  it("returns an empty string for unparseable input (never 'Invalid Date')", () => {
    expect(formatExportDate("not-a-date", "MM/DD/YYYY")).toBe("")
  })

  it("formats MM/DD/YYYY (default) with zero-padding and HH:MM time", () => {
    expect(formatExportDate(iso, "MM/DD/YYYY")).toBe("01/05/2024 09:07")
  })

  it("formats DD/MM/YYYY", () => {
    expect(formatExportDate(iso, "DD/MM/YYYY")).toBe("05/01/2024 09:07")
  })

  it("formats YYYY-MM-DD", () => {
    expect(formatExportDate(iso, "YYYY-MM-DD")).toBe("2024-01-05 09:07")
  })

  it("omits the time when withTime is false", () => {
    expect(formatExportDate(iso, "YYYY-MM-DD", false)).toBe("2024-01-05")
    expect(formatExportDate(iso, "MM/DD/YYYY", false)).toBe("01/05/2024")
  })

  it("falls back to MM/DD/YYYY for an unknown date format", () => {
    expect(
      formatExportDate(iso, "bogus" as unknown as "MM/DD/YYYY", false),
    ).toBe("01/05/2024")
  })
})
