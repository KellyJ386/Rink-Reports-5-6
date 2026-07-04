import { describe, expect, it } from "vitest"

import { formatWallClock } from "./wall-clock"

describe("formatWallClock", () => {
  it("renders the UTC components regardless of the runtime timezone", () => {
    // The stored value is the reporter's wall clock serialized as-if-UTC, so
    // the output must always echo those components back.
    expect(formatWallClock("2026-07-04T10:30:00.000Z")).toBe(
      "Jul 4, 2026, 10:30 AM",
    )
    expect(formatWallClock("2026-01-15T23:05:00+00:00")).toBe(
      "Jan 15, 2026, 11:05 PM",
    )
  })

  it("returns unparseable input unchanged", () => {
    expect(formatWallClock("not-a-date")).toBe("not-a-date")
  })
})
