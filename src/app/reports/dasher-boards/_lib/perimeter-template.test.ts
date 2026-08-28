import { describe, expect, it } from "vitest"

import {
  STANDARD_RINK_TEMPLATE,
  templateToRpcArrays,
  type TemplateSegment,
} from "./perimeter-template"

// ---------------------------------------------------------------------------
// Template structure and size
// ---------------------------------------------------------------------------

describe("STANDARD_RINK_TEMPLATE", () => {
  it("has exactly 50 entries", () => {
    expect(STANDARD_RINK_TEMPLATE).toHaveLength(50)
  })

  it("counts by type: 33 board_panel, 12 corner_radius, 5 door, 0 post_gap", () => {
    const counts = {
      board_panel: 0,
      corner_radius: 0,
      door: 0,
      post_gap: 0,
    }
    for (const segment of STANDARD_RINK_TEMPLATE) {
      counts[segment.type as keyof typeof counts]++
    }
    expect(counts).toEqual({
      board_panel: 33,
      corner_radius: 12,
      door: 5,
      post_gap: 0,
    })
  })

  it("has exactly 1 Zamboni door, 2 Penalty doors, 2 Bench doors", () => {
    const doorsBySubtype = {
      Zamboni: 0,
      Penalty: 0,
      Bench: 0,
    }
    for (const segment of STANDARD_RINK_TEMPLATE) {
      if (segment.type === "door" && segment.doorSubtypeLabel) {
        doorsBySubtype[
          segment.doorSubtypeLabel as keyof typeof doorsBySubtype
        ]++
      }
    }
    expect(doorsBySubtype).toEqual({
      Zamboni: 1,
      Penalty: 2,
      Bench: 2,
    })
  })

  it("has doorSubtypeLabel = null for all non-door segments", () => {
    for (const segment of STANDARD_RINK_TEMPLATE) {
      if (segment.type !== "door") {
        expect(segment.doorSubtypeLabel).toBeNull()
      }
    }
  })

  it("assigns every segment one of the seven default zone names (none null)", () => {
    const validZones = new Set([
      "North End",
      "South End",
      "East Side",
      "West Side",
      "Home Bench",
      "Visitor Bench",
      "Penalty Boxes",
    ])
    for (const segment of STANDARD_RINK_TEMPLATE) {
      expect(segment.zoneName).not.toBeNull()
      expect(validZones).toContain(segment.zoneName)
    }
  })

  it("uses all seven zone names in the template", () => {
    const usedZones = new Set<string>()
    for (const segment of STANDARD_RINK_TEMPLATE) {
      if (segment.zoneName) usedZones.add(segment.zoneName)
    }
    expect(usedZones).toEqual(
      new Set([
        "North End",
        "South End",
        "East Side",
        "West Side",
        "Home Bench",
        "Visitor Bench",
        "Penalty Boxes",
      ]),
    )
  })
})

// ---------------------------------------------------------------------------
// templateToRpcArrays conversion
// ---------------------------------------------------------------------------

describe("templateToRpcArrays", () => {
  it("returns three arrays of length 50", () => {
    const arrays = templateToRpcArrays(STANDARD_RINK_TEMPLATE)
    expect(arrays.types).toHaveLength(50)
    expect(arrays.doorSubtypes).toHaveLength(50)
    expect(arrays.zoneNames).toHaveLength(50)
  })

  it("types array matches template types in order", () => {
    const arrays = templateToRpcArrays(STANDARD_RINK_TEMPLATE)
    for (let i = 0; i < STANDARD_RINK_TEMPLATE.length; i++) {
      expect(arrays.types[i]).toBe(STANDARD_RINK_TEMPLATE[i].type)
    }
  })

  it("doorSubtypes array matches template doorSubtypeLabel in order", () => {
    const arrays = templateToRpcArrays(STANDARD_RINK_TEMPLATE)
    for (let i = 0; i < STANDARD_RINK_TEMPLATE.length; i++) {
      expect(arrays.doorSubtypes[i]).toBe(
        STANDARD_RINK_TEMPLATE[i].doorSubtypeLabel ?? "",
      )
    }
  })

  it("zoneNames array matches template zoneName in order", () => {
    const arrays = templateToRpcArrays(STANDARD_RINK_TEMPLATE)
    for (let i = 0; i < STANDARD_RINK_TEMPLATE.length; i++) {
      expect(arrays.zoneNames[i]).toBe(STANDARD_RINK_TEMPLATE[i].zoneName ?? "")
    }
  })

  it("round-trips: converting and indexing recovers the original template", () => {
    const arrays = templateToRpcArrays(STANDARD_RINK_TEMPLATE)
    for (let i = 0; i < STANDARD_RINK_TEMPLATE.length; i++) {
      expect({
        type: arrays.types[i],
        doorSubtypeLabel: arrays.doorSubtypes[i],
        zoneName: arrays.zoneNames[i],
      }).toEqual({
        type: STANDARD_RINK_TEMPLATE[i].type,
        doorSubtypeLabel: STANDARD_RINK_TEMPLATE[i].doorSubtypeLabel ?? "",
        zoneName: STANDARD_RINK_TEMPLATE[i].zoneName ?? "",
      })
    }
  })

  it("works on an arbitrary template", () => {
    const custom: TemplateSegment[] = [
      { type: "board_panel", doorSubtypeLabel: null, zoneName: "North End" },
      { type: "door", doorSubtypeLabel: "Zamboni", zoneName: "North End" },
      { type: "corner_radius", doorSubtypeLabel: null, zoneName: "East Side" },
    ]
    const arrays = templateToRpcArrays(custom)
    expect(arrays.types).toEqual(["board_panel", "door", "corner_radius"])
    expect(arrays.doorSubtypes).toEqual(["", "Zamboni", ""])
    expect(arrays.zoneNames).toEqual(["North End", "North End", "East Side"])
  })
})
