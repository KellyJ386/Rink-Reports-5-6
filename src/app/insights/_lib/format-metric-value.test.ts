import { describe, expect, it } from "vitest"

import { formatMetricValue } from "./format-metric-value"

describe("formatMetricValue", () => {
  it("treats null/undefined as empty", () => {
    expect(formatMetricValue(null, null)).toEqual({ kind: "empty" })
    expect(formatMetricValue(undefined, null)).toEqual({ kind: "empty" })
  })

  it("formats an integer bare, with the unit appended when given", () => {
    expect(formatMetricValue(4, null)).toEqual({ kind: "scalar", text: "4" })
    expect(formatMetricValue(4, "readings")).toEqual({ kind: "scalar", text: "4 readings" })
  })

  it("formats a fractional number to at most 2 decimals", () => {
    expect(formatMetricValue(2.696, "in")).toEqual({ kind: "scalar", text: "2.7 in" })
    expect(formatMetricValue(50.0, "%")).toEqual({ kind: "scalar", text: "50 %" })
  })

  it("formats booleans as Yes/No", () => {
    expect(formatMetricValue(true, null)).toEqual({ kind: "scalar", text: "Yes" })
    expect(formatMetricValue(false, null)).toEqual({ kind: "scalar", text: "No" })
  })

  it("treats an empty object/array as empty, not a zero-entry breakdown", () => {
    expect(formatMetricValue({}, null)).toEqual({ kind: "empty" })
    expect(formatMetricValue([], null)).toEqual({ kind: "empty" })
  })

  it("formats a breakdown object's numeric values", () => {
    expect(formatMetricValue({ slip: 2, fall: 1 }, null)).toEqual({
      kind: "breakdown",
      entries: [
        { key: "slip", text: "2" },
        { key: "fall", text: "1" },
      ],
    })
  })

  it("formats a label list as items", () => {
    expect(formatMetricValue(["Ice surface temp", "Suction pressure"], null)).toEqual({
      kind: "list",
      items: ["Ice surface temp", "Suction pressure"],
    })
  })
})
