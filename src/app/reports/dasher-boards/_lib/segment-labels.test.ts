import { describe, expect, it } from "vitest"

import {
  ALIAS_MAX,
  CUSTOM_LABEL_MAX,
  MAX_ALIASES,
  aliasesSchema,
  buildBulkLabelPreview,
  bulkLabelPatternSchema,
  customLabelSchema,
  findDuplicateLabels,
  zoneNameSchema,
  type BulkLabelPreviewEntry,
} from "./segment-labels"

describe("customLabelSchema", () => {
  it("accepts trimmed strings 1..40 chars", () => {
    expect(customLabelSchema.parse("A")).toBe("A")
    expect(customLabelSchema.parse("  Zam Gate Left  ")).toBe("Zam Gate Left")
    expect(customLabelSchema.parse("x".repeat(CUSTOM_LABEL_MAX))).toBe("x".repeat(CUSTOM_LABEL_MAX))
  })

  it("rejects empty or whitespace-only strings", () => {
    expect(() => customLabelSchema.parse("")).toThrow()
    expect(() => customLabelSchema.parse("   ")).toThrow()
  })

  it("rejects strings over 40 chars", () => {
    expect(() => customLabelSchema.parse("x".repeat(CUSTOM_LABEL_MAX + 1))).toThrow()
  })
})

describe("zoneNameSchema", () => {
  it("accepts trimmed strings 1..60 chars", () => {
    expect(zoneNameSchema.parse("North End")).toBe("North End")
    expect(zoneNameSchema.parse("  Home Bench  ")).toBe("Home Bench")
    expect(zoneNameSchema.parse("x".repeat(60))).toBe("x".repeat(60))
  })

  it("rejects empty or whitespace-only strings", () => {
    expect(() => zoneNameSchema.parse("")).toThrow()
    expect(() => zoneNameSchema.parse("   ")).toThrow()
  })

  it("rejects strings over 60 chars", () => {
    expect(() => zoneNameSchema.parse("x".repeat(61))).toThrow()
  })
})

describe("aliasesSchema", () => {
  it("accepts an empty array", () => {
    expect(aliasesSchema.parse([])).toEqual([])
  })

  it("accepts trimmed strings and removes empty entries", () => {
    expect(aliasesSchema.parse(["  Gate  ", "  "])).toEqual(["Gate"])
  })

  it("dedupes case-insensitively, preserving first occurrence order", () => {
    const result = aliasesSchema.parse([
      "Zam Gate",
      "zam gate",
      "North",
    ])
    expect(result).toEqual(["Zam Gate", "North"])
  })

  it("rejects a 13-element array (over MAX_ALIASES)", () => {
    const arr = Array.from({ length: 13 }, (_, i) => `Alias ${i}`)
    expect(() => aliasesSchema.parse(arr)).toThrow()
  })

  it("rejects elements over ALIAS_MAX chars", () => {
    const longAlias = "x".repeat(ALIAS_MAX + 1)
    expect(() => aliasesSchema.parse([longAlias])).toThrow()
  })

  it("accepts MAX_ALIASES entries", () => {
    const arr = Array.from({ length: MAX_ALIASES }, (_, i) => `Alias ${i}`)
    const result = aliasesSchema.parse(arr)
    expect(result.length).toBe(MAX_ALIASES)
  })
})

describe("bulkLabelPatternSchema", () => {
  it("accepts a valid pattern", () => {
    const result = bulkLabelPatternSchema.parse({
      prefix: "G",
      start: 1,
      step: 1,
      direction: "with_sequence",
    })
    expect(result.prefix).toBe("G")
    expect(result.start).toBe(1)
    expect(result.step).toBe(1)
    expect(result.direction).toBe("with_sequence")
  })

  it("rejects step 0", () => {
    expect(() =>
      bulkLabelPatternSchema.parse({
        prefix: "G",
        start: 1,
        step: 0,
        direction: "with_sequence",
      }),
    ).toThrow()
  })

  it("rejects start 10000", () => {
    expect(() =>
      bulkLabelPatternSchema.parse({
        prefix: "G",
        start: 10000,
        step: 1,
        direction: "with_sequence",
      }),
    ).toThrow()
  })

  it("accepts start at max boundary", () => {
    const result = bulkLabelPatternSchema.parse({
      prefix: "G",
      start: 9999,
      step: 1,
      direction: "with_sequence",
    })
    expect(result.start).toBe(9999)
  })

  it("accepts both direction values", () => {
    const withSeq = bulkLabelPatternSchema.parse({
      prefix: "G",
      start: 1,
      step: 1,
      direction: "with_sequence",
    })
    expect(withSeq.direction).toBe("with_sequence")

    const againstSeq = bulkLabelPatternSchema.parse({
      prefix: "G",
      start: 1,
      step: 1,
      direction: "against_sequence",
    })
    expect(againstSeq.direction).toBe("against_sequence")
  })

  it("trims the prefix", () => {
    const result = bulkLabelPatternSchema.parse({
      prefix: "  G  ",
      start: 1,
      step: 1,
      direction: "with_sequence",
    })
    expect(result.prefix).toBe("G")
  })
})

describe("buildBulkLabelPreview", () => {
  it("generates labels in order for with_sequence", () => {
    const ids = ["a1", "a2", "a3"]
    const preview = buildBulkLabelPreview(ids, {
      prefix: "G",
      start: 1,
      step: 1,
      direction: "with_sequence",
    })
    expect(preview).toEqual([
      { assetId: "a1", customLabel: "G1" },
      { assetId: "a2", customLabel: "G2" },
      { assetId: "a3", customLabel: "G3" },
    ] as BulkLabelPreviewEntry[])
  })

  it("reverses assignment for against_sequence", () => {
    const ids = ["a1", "a2", "a3"]
    const preview = buildBulkLabelPreview(ids, {
      prefix: "G",
      start: 1,
      step: 1,
      direction: "against_sequence",
    })
    expect(preview).toEqual([
      { assetId: "a3", customLabel: "G1" },
      { assetId: "a2", customLabel: "G2" },
      { assetId: "a1", customLabel: "G3" },
    ] as BulkLabelPreviewEntry[])
  })

  it("handles empty prefix", () => {
    const ids = ["a1", "a2"]
    const preview = buildBulkLabelPreview(ids, {
      prefix: "",
      start: 5,
      step: 1,
      direction: "with_sequence",
    })
    expect(preview).toEqual([
      { assetId: "a1", customLabel: "5" },
      { assetId: "a2", customLabel: "6" },
    ] as BulkLabelPreviewEntry[])
  })

  it("handles step > 1", () => {
    const ids = ["a1", "a2", "a3"]
    const preview = buildBulkLabelPreview(ids, {
      prefix: "Z",
      start: 10,
      step: 2,
      direction: "with_sequence",
    })
    expect(preview).toEqual([
      { assetId: "a1", customLabel: "Z10" },
      { assetId: "a2", customLabel: "Z12" },
      { assetId: "a3", customLabel: "Z14" },
    ] as BulkLabelPreviewEntry[])
  })
})

describe("findDuplicateLabels", () => {
  it("returns an empty array for a clean batch", () => {
    const entries = [
      { assetId: "a1", customLabel: "Zone A" },
      { assetId: "a2", customLabel: "Zone B" },
    ]
    const existing = new Set<string>()
    const dups = findDuplicateLabels(entries, existing)
    expect(dups).toEqual([])
  })

  it("flags an in-batch case-insensitive collision", () => {
    const entries = [
      { assetId: "a1", customLabel: "Zam Gate" },
      { assetId: "a2", customLabel: "zam gate" },
      { assetId: "a3", customLabel: "North" },
    ]
    const existing = new Set<string>()
    const dups = findDuplicateLabels(entries, existing)
    expect(dups).toContain("Zam Gate")
    expect(dups).toContain("zam gate")
    expect(dups).not.toContain("North")
  })

  it("flags a collision with existingLabelsLower", () => {
    const entries = [
      { assetId: "a1", customLabel: "Zone A" },
      { assetId: "a2", customLabel: "Zone B" },
    ]
    const existing = new Set(["zone a"])
    const dups = findDuplicateLabels(entries, existing)
    expect(dups).toContain("Zone A")
    expect(dups).not.toContain("Zone B")
  })

  it("dedupes the result (returns each collision once)", () => {
    const entries = [
      { assetId: "a1", customLabel: "Collision" },
      { assetId: "a2", customLabel: "COLLISION" },
      { assetId: "a3", customLabel: "collision" },
    ]
    const existing = new Set<string>()
    const dups = findDuplicateLabels(entries, existing)
    // Should contain the three original casings, each once as a string
    expect(new Set(dups).size).toBe(3)
  })

  it("handles multiple collisions", () => {
    const entries = [
      { assetId: "a1", customLabel: "Dupe1" },
      { assetId: "a2", customLabel: "dupe1" },
      { assetId: "a3", customLabel: "Dupe2" },
      { assetId: "a4", customLabel: "DUPE2" },
      { assetId: "a5", customLabel: "Unique" },
    ]
    const existing = new Set<string>()
    const dups = findDuplicateLabels(entries, existing)
    expect(dups).toContain("Dupe1")
    expect(dups).toContain("dupe1")
    expect(dups).toContain("Dupe2")
    expect(dups).toContain("DUPE2")
    expect(dups).not.toContain("Unique")
  })
})
