import { describe, expect, it } from "vitest"

import {
  buildInputFromObject,
  buildInputFromPayload,
  dedupeMeasurements,
  parseMeasurements,
  severityFor,
  shouldFireAlert,
  summarizeMeasurements,
} from "./compute"

const LAYOUT_ID = "11111111-1111-4111-8111-111111111111"
const P1 = "22222222-2222-4222-8222-222222222222"
const P2 = "33333333-3333-4333-8333-333333333333"

// ---------------------------------------------------------------------------
// parseMeasurements
// ---------------------------------------------------------------------------

describe("parseMeasurements", () => {
  it("parses a JSON string of valid measurements", () => {
    const raw = JSON.stringify([{ point_id: P1, depth_value: 1.25 }])
    expect(parseMeasurements(raw)).toEqual([{ point_id: P1, depth_value: 1.25 }])
  })

  it("parses an already-parsed array (offline path)", () => {
    expect(parseMeasurements([{ point_id: P1, depth_value: 2 }])).toEqual([
      { point_id: P1, depth_value: 2 },
    ])
  })

  it("coerces numeric strings to numbers", () => {
    expect(parseMeasurements([{ point_id: P1, depth_value: "1.5" }])).toEqual([
      { point_id: P1, depth_value: 1.5 },
    ])
  })

  it("returns null on malformed JSON", () => {
    expect(parseMeasurements("{not json")).toBeNull()
  })

  it("returns null when not an array", () => {
    expect(parseMeasurements({ point_id: P1 })).toBeNull()
    expect(parseMeasurements(42)).toBeNull()
  })

  it("returns null when a point_id is not a UUID", () => {
    expect(parseMeasurements([{ point_id: "nope", depth_value: 1 }])).toBeNull()
  })

  it("returns null when depth is not finite", () => {
    expect(parseMeasurements([{ point_id: P1, depth_value: "abc" }])).toBeNull()
    expect(parseMeasurements([{ point_id: P1 }])).toBeNull()
  })

  it("accepts an empty array", () => {
    expect(parseMeasurements([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// buildInputFromObject / buildInputFromPayload
// ---------------------------------------------------------------------------

describe("buildInputFromObject", () => {
  it("returns null for non-objects", () => {
    expect(buildInputFromObject(null)).toBeNull()
    expect(buildInputFromObject("nope")).toBeNull()
  })

  it("returns null when layout_id is not a UUID", () => {
    expect(
      buildInputFromObject({
        layout_id: "bad",
        layout_slug: "main-rink",
        measurements: [],
      }),
    ).toBeNull()
  })

  it("returns null when layout_slug is empty", () => {
    expect(
      buildInputFromObject({
        layout_id: LAYOUT_ID,
        layout_slug: "  ",
        measurements: [],
      }),
    ).toBeNull()
  })

  it("returns null when measurements are malformed", () => {
    expect(
      buildInputFromObject({
        layout_id: LAYOUT_ID,
        layout_slug: "main-rink",
        measurements: [{ point_id: "bad", depth_value: 1 }],
      }),
    ).toBeNull()
  })

  it("builds a normalized input, trimming + nulling empty notes", () => {
    expect(
      buildInputFromObject({
        layout_id: LAYOUT_ID,
        layout_slug: "  main-rink  ",
        notes: "   ",
        measurements: [{ point_id: P1, depth_value: 1.25 }],
      }),
    ).toEqual({
      layout_id: LAYOUT_ID,
      layout_slug: "main-rink",
      notes: null,
      measurements: [{ point_id: P1, depth_value: 1.25 }],
    })
  })

  it("keeps non-empty trimmed notes", () => {
    expect(
      buildInputFromObject({
        layout_id: LAYOUT_ID,
        layout_slug: "main-rink",
        notes: "  thin near goal  ",
        measurements: [],
      })!.notes,
    ).toBe("thin near goal")
  })

  it("accepts measurements under the measurements_json key (form mirror)", () => {
    const out = buildInputFromObject({
      layout_id: LAYOUT_ID,
      layout_slug: "main-rink",
      measurements_json: JSON.stringify([{ point_id: P2, depth_value: 0.5 }]),
    })
    expect(out!.measurements).toEqual([{ point_id: P2, depth_value: 0.5 }])
  })

  it("buildInputFromPayload is the offline alias", () => {
    expect(
      buildInputFromPayload({
        layout_id: LAYOUT_ID,
        layout_slug: "main-rink",
        measurements: [{ point_id: P1, depth_value: 1 }],
      }),
    ).toEqual({
      layout_id: LAYOUT_ID,
      layout_slug: "main-rink",
      notes: null,
      measurements: [{ point_id: P1, depth_value: 1 }],
    })
  })
})

// ---------------------------------------------------------------------------
// dedupeMeasurements
// ---------------------------------------------------------------------------

describe("dedupeMeasurements", () => {
  it("dedupes by point_id with last write winning", () => {
    const map = dedupeMeasurements([
      { point_id: P1, depth_value: 1 },
      { point_id: P2, depth_value: 2 },
      { point_id: P1, depth_value: 9 },
    ])
    expect(map.size).toBe(2)
    expect(map.get(P1)).toBe(9)
    expect(map.get(P2)).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// severityFor — per-point classification
// ---------------------------------------------------------------------------

describe("severityFor", () => {
  const low = 1
  const high = 1.5

  it("classifies values at or below low as low", () => {
    expect(severityFor(0.5, low, high)).toBe("low")
    expect(severityFor(1, low, high)).toBe("low") // boundary: <= low
  })

  it("classifies values strictly above high as high", () => {
    expect(severityFor(1.6, low, high)).toBe("high")
    expect(severityFor(1.5, low, high)).toBe("ok") // boundary: not > high
  })

  it("classifies in-range values as ok", () => {
    expect(severityFor(1.25, low, high)).toBe("ok")
  })
})

// ---------------------------------------------------------------------------
// summarizeMeasurements — session-counter rollup
// ---------------------------------------------------------------------------

describe("summarizeMeasurements", () => {
  it("counts low/high and totals", () => {
    expect(summarizeMeasurements(["ok", "low", "high", "low", "ok"])).toEqual({
      total_measurements: 5,
      low_count: 2,
      high_count: 1,
      has_low_reading: true,
      has_high_reading: true,
    })
  })

  it("reports all-ok with zero flags", () => {
    expect(summarizeMeasurements(["ok", "ok"])).toEqual({
      total_measurements: 2,
      low_count: 0,
      high_count: 0,
      has_low_reading: false,
      has_high_reading: false,
    })
  })

  it("handles an empty session", () => {
    expect(summarizeMeasurements([])).toEqual({
      total_measurements: 0,
      low_count: 0,
      high_count: 0,
      has_low_reading: false,
      has_high_reading: false,
    })
  })
})

// ---------------------------------------------------------------------------
// shouldFireAlert — alert gating
// ---------------------------------------------------------------------------

describe("shouldFireAlert", () => {
  it("fires on 'low' only when a low reading exists", () => {
    expect(shouldFireAlert("low", true, false)).toBe(true)
    expect(shouldFireAlert("low", false, true)).toBe(false)
  })

  it("fires on 'high' only when a high reading exists", () => {
    expect(shouldFireAlert("high", false, true)).toBe(true)
    expect(shouldFireAlert("high", true, false)).toBe(false)
  })

  it("fires on 'any' when either is present", () => {
    expect(shouldFireAlert("any", true, false)).toBe(true)
    expect(shouldFireAlert("any", false, true)).toBe(true)
    expect(shouldFireAlert("any", false, false)).toBe(false)
  })

  it("never fires for unknown/null alert_on", () => {
    expect(shouldFireAlert(null, true, true)).toBe(false)
    expect(shouldFireAlert(undefined, true, true)).toBe(false)
    expect(shouldFireAlert("off", true, true)).toBe(false)
  })
})
