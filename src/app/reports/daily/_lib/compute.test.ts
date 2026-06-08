import { describe, expect, it } from "vitest"

import {
  buildInputFromObject,
  buildInputFromPayload,
  parseItems,
  parseItemsJson,
} from "./compute"

// ---------------------------------------------------------------------------
// parseItems — checklist validation (incl. the previously-opaque "not array")
// ---------------------------------------------------------------------------

describe("parseItems", () => {
  it("returns a clean error (not a throw) when the value is not an array", () => {
    const res = parseItems({ nope: true })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe("Invalid form data.")
  })

  it("rejects non-array primitives", () => {
    expect(parseItems(null).ok).toBe(false)
    expect(parseItems("[]").ok).toBe(false)
    expect(parseItems(42).ok).toBe(false)
  })

  it("normalizes rows, coercing missing fields to safe defaults", () => {
    const res = parseItems([
      { checklist_item_id: "i1", label_snapshot: "Check ice", is_checked: true },
      { checklist_item_id: "i2", label_snapshot: "Sweep", is_checked: 0 },
      {},
    ])
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.items).toEqual([
        { checklist_item_id: "i1", label_snapshot: "Check ice", is_checked: true },
        { checklist_item_id: "i2", label_snapshot: "Sweep", is_checked: false },
        { checklist_item_id: "", label_snapshot: "", is_checked: false },
      ])
    }
  })

  it("accepts an empty array", () => {
    const res = parseItems([])
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.items).toEqual([])
  })
})

describe("parseItemsJson", () => {
  it("treats absent/blank as an empty list", () => {
    expect(parseItemsJson(undefined)).toEqual({ ok: true, items: [] })
    expect(parseItemsJson("")).toEqual({ ok: true, items: [] })
  })

  it("returns a clean error on malformed JSON", () => {
    const res = parseItemsJson("{not json")
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe("Invalid form data.")
  })

  it("returns a clean error when the JSON parses to a non-array", () => {
    const res = parseItemsJson(JSON.stringify({ a: 1 }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe("Invalid form data.")
  })

  it("parses a serialized item array", () => {
    const res = parseItemsJson(
      JSON.stringify([
        { checklist_item_id: "i1", label_snapshot: "x", is_checked: true },
      ]),
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.items).toEqual([
        { checklist_item_id: "i1", label_snapshot: "x", is_checked: true },
      ])
    }
  })
})

// ---------------------------------------------------------------------------
// buildInputFromObject / buildInputFromPayload — offline payload parsing
// ---------------------------------------------------------------------------

describe("buildInputFromObject", () => {
  it("returns null for non-objects", () => {
    expect(buildInputFromObject(null)).toBeNull()
    expect(buildInputFromObject("nope")).toBeNull()
  })

  it("returns null when a required identifier is missing", () => {
    expect(
      buildInputFromObject({ area_id: "a1", area_slug: "main" }),
    ).toBeNull()
    expect(
      buildInputFromObject({ template_id: "t1", area_slug: "main" }),
    ).toBeNull()
    expect(
      buildInputFromObject({ template_id: "t1", area_id: "a1" }),
    ).toBeNull()
  })

  it("trims identifiers and note, defaulting items to empty", () => {
    const out = buildInputFromObject({
      template_id: " t1 ",
      area_id: " a1 ",
      area_slug: " main ",
      note: "  watch the compressor  ",
    })!
    expect(out).toEqual({
      template_id: "t1",
      area_id: "a1",
      area_slug: "main",
      note: "watch the compressor",
      items: [],
    })
  })

  it("accepts items as an already-parsed array", () => {
    const out = buildInputFromObject({
      template_id: "t1",
      area_id: "a1",
      area_slug: "main",
      items: [
        { checklist_item_id: "i1", label_snapshot: "x", is_checked: true },
      ],
    })!
    expect(out.items).toEqual([
      { checklist_item_id: "i1", label_snapshot: "x", is_checked: true },
    ])
  })

  it("accepts items as a serialized items_json string", () => {
    const out = buildInputFromObject({
      template_id: "t1",
      area_id: "a1",
      area_slug: "main",
      items_json: JSON.stringify([
        { checklist_item_id: "i1", label_snapshot: "x", is_checked: false },
      ]),
    })!
    expect(out.items).toEqual([
      { checklist_item_id: "i1", label_snapshot: "x", is_checked: false },
    ])
  })

  it("returns null when items carry a malformed (non-array) value", () => {
    expect(
      buildInputFromObject({
        template_id: "t1",
        area_id: "a1",
        area_slug: "main",
        items: { not: "an array" },
      }),
    ).toBeNull()
  })

  it("buildInputFromPayload is an alias of buildInputFromObject", () => {
    const obj = {
      template_id: "t1",
      area_id: "a1",
      area_slug: "main",
      note: "n",
      items: [],
    }
    expect(buildInputFromPayload(obj)).toEqual(buildInputFromObject(obj))
  })
})
