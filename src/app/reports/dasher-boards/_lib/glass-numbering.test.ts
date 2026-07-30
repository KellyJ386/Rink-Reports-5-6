import { describe, expect, it } from "vitest"

import {
  DEFAULT_GLASS_NUMBERING,
  computeGlassNumbers,
  formatAssetLabel,
  formatGlassLabelWithIdentity,
  numberingStartIndex,
  positionsFromAssets,
  previewGlassNumbers,
  resolveGlassLabel,
  schemeFromRink,
  type GlassNumberingScheme,
  type NumberedPositionLite,
} from "./glass-numbering"

/** n board positions, ids b1..bn, each with glass child g1..gn. */
function ring(n: number, doorsAt: number[] = []): NumberedPositionLite[] {
  return Array.from({ length: n }, (_, i) => {
    const pos = i + 1
    const isDoor = doorsAt.includes(pos)
    return {
      id: `b${pos}`,
      asset_type: isDoor ? ("door" as const) : ("board_panel" as const),
      glassAssetId: isDoor ? null : `g${pos}`,
      displayNumber: null,
    }
  })
}

const on: GlassNumberingScheme = { ...DEFAULT_GLASS_NUMBERING, enabled: true }

describe("computeGlassNumbers", () => {
  it("returns nothing while numbering is off (surfaces fall back to labels)", () => {
    expect(
      computeGlassNumbers(ring(4), DEFAULT_GLASS_NUMBERING, "clockwise", 0)
        .size,
    ).toBe(0)
  })

  it("numbers positions in sequence order from the board anchor", () => {
    const n = computeGlassNumbers(ring(3), on, "clockwise", 0)
    expect(n.get("b1")).toBe("G1")
    expect(n.get("b2")).toBe("G2")
    expect(n.get("b3")).toBe("G3")
  })

  it("keys the same number under the position and its glass child", () => {
    const n = computeGlassNumbers(ring(2), on, "clockwise", 0)
    expect(n.get("g1")).toBe("G1")
    expect(n.get("g2")).toBe("G2")
  })

  it("honors the prefix and the first number", () => {
    const n = computeGlassNumbers(
      ring(3),
      { ...on, prefix: "", start: 101 },
      "clockwise",
      0,
    )
    expect([n.get("b1"), n.get("b2"), n.get("b3")]).toEqual([
      "101",
      "102",
      "103",
    ])
  })

  it("walks the other way when the direction opposes the board order", () => {
    // Board ring drawn clockwise; glass numbered counterclockwise from the
    // same start, so panel 1 keeps #1 and the rest reverse.
    const n = computeGlassNumbers(
      ring(4),
      { ...on, direction: "counterclockwise" },
      "clockwise",
      0,
    )
    expect(n.get("b1")).toBe("G1")
    expect(n.get("b4")).toBe("G2")
    expect(n.get("b3")).toBe("G3")
    expect(n.get("b2")).toBe("G4")
  })

  it("treats follow_boards as the rink's own direction", () => {
    const followed = computeGlassNumbers(ring(4), on, "counterclockwise", 0)
    const pinned = computeGlassNumbers(
      ring(4),
      { ...on, direction: "counterclockwise" },
      "counterclockwise",
      0,
    )
    expect([...followed.entries()]).toEqual([...pinned.entries()])
  })

  it("starts at the panel covering a separate glass anchor", () => {
    // 4 panels, board anchor at 0: each spans a quarter of the boundary.
    // A glass anchor at 0.5 falls in the third span.
    const n = computeGlassNumbers(
      ring(4),
      { ...on, anchorOffset: 0.5 },
      "clockwise",
      0,
    )
    expect(n.get("b3")).toBe("G1")
    expect(n.get("b4")).toBe("G2")
    expect(n.get("b1")).toBe("G3")
    expect(n.get("b2")).toBe("G4")
  })

  it("wraps when the glass anchor sits behind the board anchor", () => {
    const n = computeGlassNumbers(
      ring(4),
      { ...on, anchorOffset: 0.1 },
      "clockwise",
      0.6,
    )
    // 0.1 is half a turn past 0.6 going clockwise -> the third span.
    expect(n.get("b3")).toBe("G1")
    expect(n.get("b2")).toBe("G4")
  })

  it("counts doors by default (a door carries its own glass)", () => {
    const n = computeGlassNumbers(ring(4, [2]), on, "clockwise", 0)
    expect(n.get("b2")).toBe("G2")
    expect(n.get("b3")).toBe("G3")
  })

  it("closes the gap when doors are excluded", () => {
    const n = computeGlassNumbers(
      ring(4, [2]),
      { ...on, includeDoors: false },
      "clockwise",
      0,
    )
    expect(n.has("b2")).toBe(false)
    expect(n.get("b1")).toBe("G1")
    expect(n.get("b3")).toBe("G2")
    expect(n.get("b4")).toBe("G3")
  })

  it("lets a per-panel override win without shifting its neighbours", () => {
    const positions = ring(4)
    positions[1] = { ...positions[1], displayNumber: "12A" }
    const n = computeGlassNumbers(positions, on, "clockwise", 0)
    expect(n.get("b1")).toBe("G1")
    expect(n.get("b2")).toBe("12A")
    expect(n.get("g2")).toBe("12A")
    expect(n.get("b3")).toBe("G3")
  })

  it("handles an empty perimeter", () => {
    expect(computeGlassNumbers([], on, "clockwise", 0).size).toBe(0)
  })

  it("numbers every position exactly once around the ring", () => {
    const n = computeGlassNumbers(ring(64), on, "clockwise", 0.37)
    const values = new Set(
      ring(64).map((p) => n.get(p.id) as string),
    )
    expect(values.size).toBe(64)
    expect(values.has("G1")).toBe(true)
    expect(values.has("G64")).toBe(true)
  })
})

describe("numberingStartIndex", () => {
  it("starts at position 1 when the anchors coincide", () => {
    expect(numberingStartIndex(8, { anchorOffset: null }, "clockwise", 0.4)).toBe(
      0,
    )
  })

  it("mirrors the offset on a counterclockwise ring", () => {
    expect(
      numberingStartIndex(4, { anchorOffset: 0.25 }, "counterclockwise", 0),
    ).toBe(3)
    expect(numberingStartIndex(4, { anchorOffset: 0.25 }, "clockwise", 0)).toBe(
      1,
    )
  })
})

describe("resolveGlassLabel", () => {
  it("falls back to the permanent label when numbering is off", () => {
    const r = resolveGlassLabel({ id: "g9", label: "G9" }, new Map())
    expect(r).toEqual({ display: "G9", identity: "G9", isNumbered: false })
  })

  it("prefers the scheme number and keeps identity alongside", () => {
    const r = resolveGlassLabel(
      { id: "g9", label: "G41" },
      new Map([["g9", "G9"]]),
    )
    expect(r).toEqual({ display: "G9", identity: "G41", isNumbered: true })
  })
})

describe("formatGlassLabelWithIdentity", () => {
  it("shows both when they differ", () => {
    expect(
      formatGlassLabelWithIdentity(
        { id: "g9", label: "G41" },
        new Map([["g9", "G9"]]),
      ),
    ).toBe("G9 (G41)")
  })

  it("shows one when the number matches the label", () => {
    expect(
      formatGlassLabelWithIdentity(
        { id: "g9", label: "G9" },
        new Map([["g9", "G9"]]),
      ),
    ).toBe("G9")
  })

  it("shows the label alone when numbering is off", () => {
    expect(
      formatGlassLabelWithIdentity({ id: "g9", label: "G9" }, new Map()),
    ).toBe("G9")
  })
})

describe("formatAssetLabel", () => {
  // The numbers map is keyed by position id as well as glass id, so a board
  // would otherwise print the number of the glass mounted on it.
  const numbers = new Map([
    ["b1", "G7"],
    ["g1", "G7"],
    ["d1", "G8"],
  ])

  it("leaves a board panel on its own label", () => {
    expect(
      formatAssetLabel(
        { id: "b1", label: "B41", asset_type: "board_panel" },
        numbers,
      ),
    ).toBe("B41")
  })

  it("numbers the glass panel", () => {
    expect(
      formatAssetLabel(
        { id: "g1", label: "G41", asset_type: "glass_panel" },
        numbers,
      ),
    ).toBe("G7 (G41)")
  })

  it("numbers a door, which carries its own glass", () => {
    expect(
      formatAssetLabel({ id: "d1", label: "D3", asset_type: "door" }, numbers),
    ).toBe("G8 (D3)")
  })

  it("falls back to labels when numbering is off", () => {
    expect(
      formatAssetLabel(
        { id: "g1", label: "G41", asset_type: "glass_panel" },
        new Map(),
      ),
    ).toBe("G41")
  })
})

describe("positionsFromAssets", () => {
  const assets = [
    {
      id: "b2",
      asset_type: "board_panel",
      is_active: true,
      sequence_position: 2,
      parent_board_id: null,
      display_number: null,
    },
    {
      id: "b1",
      asset_type: "board_panel",
      is_active: true,
      sequence_position: 1,
      parent_board_id: null,
      display_number: null,
    },
    {
      id: "g1",
      asset_type: "glass_panel",
      is_active: true,
      sequence_position: null,
      parent_board_id: "b1",
      display_number: "12A",
    },
    {
      id: "b3",
      asset_type: "board_panel",
      is_active: false,
      sequence_position: 3,
      parent_board_id: null,
      display_number: null,
    },
    {
      id: "d1",
      asset_type: "door",
      is_active: true,
      sequence_position: 4,
      parent_board_id: null,
      display_number: "D-GLASS",
    },
  ]

  it("keeps active positions in sequence order and drops retired ones", () => {
    expect(positionsFromAssets(assets).map((p) => p.id)).toEqual([
      "b1",
      "b2",
      "d1",
    ])
  })

  it("attaches the glass child and reads its override", () => {
    const [first] = positionsFromAssets(assets)
    expect(first.glassAssetId).toBe("g1")
    expect(first.displayNumber).toBe("12A")
  })

  it("reads a door's override off the door row itself", () => {
    const door = positionsFromAssets(assets).find((p) => p.id === "d1")!
    expect(door.glassAssetId).toBeNull()
    expect(door.displayNumber).toBe("D-GLASS")
  })
})

describe("previewGlassNumbers", () => {
  it("previews a scheme that has not been enabled yet", () => {
    expect(
      previewGlassNumbers(ring(10), DEFAULT_GLASS_NUMBERING, "clockwise", 0),
    ).toEqual(["G1", "G2", "G3", "…", "G10"])
  })

  it("reads in numbering order, not sequence order", () => {
    expect(
      previewGlassNumbers(
        ring(4),
        { ...DEFAULT_GLASS_NUMBERING, direction: "counterclockwise" },
        "clockwise",
        0,
      ),
    ).toEqual(["G1", "G2", "G3", "G4"])
  })

  it("returns the full list when it is short", () => {
    expect(
      previewGlassNumbers(ring(3), DEFAULT_GLASS_NUMBERING, "clockwise", 0),
    ).toEqual(["G1", "G2", "G3"])
  })

  it("is empty with nothing to number", () => {
    expect(
      previewGlassNumbers(
        ring(2, [1, 2]),
        { ...DEFAULT_GLASS_NUMBERING, includeDoors: false },
        "clockwise",
        0,
      ),
    ).toEqual([])
  })
})

describe("schemeFromRink", () => {
  it("reads the columns and defends against an unknown direction", () => {
    expect(
      schemeFromRink({
        glass_numbering_enabled: true,
        glass_number_prefix: "",
        glass_number_start: 0,
        glass_number_direction: "sideways",
        glass_number_anchor_offset: 0.25,
        glass_number_include_doors: false,
      }),
    ).toEqual({
      enabled: true,
      prefix: "",
      start: 0,
      direction: "follow_boards",
      anchorOffset: 0.25,
      includeDoors: false,
    })
  })
})
