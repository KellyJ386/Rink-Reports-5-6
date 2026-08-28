import { describe, expect, it } from "vitest"

import {
  formatSegmentLabelWithIdentity,
  matchingSegmentIds,
  resolveSegmentLabel,
  segmentMatchesQuery,
  type DisplayLabeledAsset,
} from "./display-label"

function asset(over: Partial<DisplayLabeledAsset> = {}): DisplayLabeledAsset {
  return {
    id: "a1",
    label: "B12",
    asset_type: "board_panel",
    custom_label: null,
    aliases: [],
    ...over,
  }
}

describe("resolveSegmentLabel", () => {
  it("prefers the custom label on any type", () => {
    const r = resolveSegmentLabel(
      asset({ custom_label: "Zam Gate Left" }),
      new Map([["a1", "#7"]]),
    )
    expect(r).toEqual({
      display: "Zam Gate Left",
      identity: "B12",
      source: "custom",
    })
  })

  it("falls back to the glass scheme number for glass-bearing rows", () => {
    const r = resolveSegmentLabel(
      asset({ id: "g1", label: "G12", asset_type: "glass_panel" }),
      new Map([["g1", "#7"]]),
    )
    expect(r).toEqual({ display: "#7", identity: "G12", source: "glass_number" })
  })

  it("never gives a board the number of the glass mounted on it", () => {
    const r = resolveSegmentLabel(asset(), new Map([["a1", "#7"]]))
    expect(r).toEqual({ display: "B12", identity: "B12", source: "identity" })
  })

  it("falls back to the permanent label with no scheme", () => {
    const r = resolveSegmentLabel(
      asset({ id: "d1", label: "D3", asset_type: "door" }),
    )
    expect(r).toEqual({ display: "D3", identity: "D3", source: "identity" })
  })

  it("treats a whitespace-only custom label as unset", () => {
    const r = resolveSegmentLabel(asset({ custom_label: "   " }))
    expect(r.source).toBe("identity")
  })
})

describe("formatSegmentLabelWithIdentity", () => {
  it("shows the identity when the display diverges", () => {
    expect(
      formatSegmentLabelWithIdentity(asset({ custom_label: "N-3" })),
    ).toBe("N-3 (B12)")
  })
  it("prints the plain label when nothing diverges", () => {
    expect(formatSegmentLabelWithIdentity(asset())).toBe("B12")
  })
})

describe("segmentMatchesQuery", () => {
  const zamGate = asset({
    id: "d5",
    label: "D5",
    asset_type: "door",
    custom_label: "Zam Gate",
    aliases: ["the Zamboni door", "machine gate"],
  })

  it("matches custom label, permanent label, and aliases, case-insensitively", () => {
    expect(segmentMatchesQuery(zamGate, "zam gate")).toBe(true)
    expect(segmentMatchesQuery(zamGate, "d5")).toBe(true)
    expect(segmentMatchesQuery(zamGate, "MACHINE")).toBe(true)
    expect(segmentMatchesQuery(zamGate, "penalty")).toBe(false)
  })

  it("matches the resolved glass number", () => {
    const glass = asset({ id: "g9", label: "G9", asset_type: "glass_panel" })
    expect(segmentMatchesQuery(glass, "14", new Map([["g9", "N14"]]))).toBe(true)
  })

  it("matches nothing on an empty or whitespace query", () => {
    expect(segmentMatchesQuery(zamGate, "")).toBe(false)
    expect(segmentMatchesQuery(zamGate, "   ")).toBe(false)
  })
})

describe("matchingSegmentIds", () => {
  const assets = [
    asset({ id: "b1", label: "B1" }),
    asset({ id: "b2", label: "B2", custom_label: "North 2" }),
    asset({
      id: "g2",
      label: "G2",
      asset_type: "glass_panel",
      aliases: ["north glass"],
    }),
  ]

  it("collects every matching id", () => {
    expect(matchingSegmentIds(assets, "north")).toEqual(new Set(["b2", "g2"]))
  })

  it("returns an empty set for an empty query (no filter)", () => {
    expect(matchingSegmentIds(assets, "").size).toBe(0)
  })
})
