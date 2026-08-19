import { describe, expect, it } from "vitest"

import { formatPdfGeneratedAt, formatPdfTimestamp } from "./format"

describe("formatPdfTimestamp", () => {
  it("renders the facility wall clock, not the server's", () => {
    // 20:00 UTC is 2 PM in Chicago. Before this helper existed the PDF layer
    // formatted with no timeZone at all, so a cron render on Vercel stamped
    // "8:00 PM" onto a report the rink filed in the afternoon.
    expect(formatPdfTimestamp("2026-01-15T20:00:00.000Z", "America/Chicago")).toBe(
      "Jan 15, 2026, 2:00 PM",
    )
    expect(formatPdfTimestamp("2026-07-04T17:30:00.000Z", "America/Los_Angeles")).toBe(
      "Jul 4, 2026, 10:30 AM",
    )
  })

  it("names the correct day across a UTC date boundary", () => {
    // The sharp edge: 02:00 UTC on the 15th is still the evening of the 14th
    // in Chicago. Formatting without a zone silently advanced the date by a
    // day on every late-evening submission.
    expect(formatPdfTimestamp("2026-01-15T02:00:00.000Z", "America/Chicago")).toBe(
      "Jan 14, 2026, 8:00 PM",
    )
  })

  it("renders an em dash for a missing timestamp", () => {
    expect(formatPdfTimestamp(null, "America/Chicago")).toBe("—")
    expect(formatPdfTimestamp(undefined, "America/Chicago")).toBe("—")
    expect(formatPdfTimestamp("", "America/Chicago")).toBe("—")
  })

  it("falls back to the runtime zone rather than throwing on a null or invalid zone", () => {
    const iso = "2026-01-15T20:00:00.000Z"
    const runtime = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso))

    expect(formatPdfTimestamp(iso, null)).toBe(runtime)
    expect(formatPdfTimestamp(iso, "Not/AZone")).toBe(runtime)
  })

  it("returns an unparseable value unchanged instead of 'Invalid Date'", () => {
    expect(formatPdfTimestamp("not-a-date", "America/Chicago")).toBe("not-a-date")
  })
})

describe("formatPdfGeneratedAt", () => {
  it("stamps the footer in the same zone as the record timestamps", () => {
    const now = new Date("2026-01-15T20:00:00.000Z")
    expect(formatPdfGeneratedAt(now, "America/Chicago")).toBe("Jan 15, 2026, 2:00 PM")
    expect(formatPdfGeneratedAt(now, "America/Chicago")).toBe(
      formatPdfTimestamp(now.toISOString(), "America/Chicago"),
    )
  })
})
