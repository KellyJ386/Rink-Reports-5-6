import { describe, expect, it } from "vitest"

import {
  buildTemplateSnapshot,
  parseFieldDefs,
  parseSnapshot,
  parseTitle,
  validateResponses,
  MAX_FIELDS_PER_TEMPLATE,
  MAX_TEXT_LENGTH,
  type TemplateSnapshot,
} from "./instance-compute"

function snap(fields: Partial<TemplateSnapshot["fields"][number]>[]): TemplateSnapshot {
  return {
    template_id: "t-1",
    template_name: "Event Set Up",
    version: 1,
    fields: fields.map((f, i) => ({
      id: f.id ?? `f-${i}`,
      label: f.label ?? `Field ${i}`,
      field_type: f.field_type ?? "text",
      options: f.options ?? null,
      required: f.required ?? false,
      sort_order: f.sort_order ?? i,
    })),
  }
}

describe("parseFieldDefs", () => {
  it("accepts a valid mixed field list", () => {
    const res = parseFieldDefs([
      { label: "Event name", field_type: "text", required: true },
      { label: "Zone", field_type: "select", options: ["North", "South"], required: false },
      { label: "Notes", field_type: "textarea" },
    ])
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.fields).toHaveLength(3)
      expect(res.fields[1].options).toEqual(["North", "South"])
      expect(res.fields[0].required).toBe(true)
      expect(res.fields[2].required).toBe(false)
    }
  })

  it("rejects non-arrays, empty lists, and oversize lists", () => {
    expect(parseFieldDefs(null).ok).toBe(false)
    expect(parseFieldDefs([]).ok).toBe(false)
    const many = Array.from({ length: MAX_FIELDS_PER_TEMPLATE + 1 }, (_, i) => ({
      label: `F${i}`,
      field_type: "text",
    }))
    expect(parseFieldDefs(many).ok).toBe(false)
  })

  it("rejects a blank label and an unknown field type", () => {
    expect(parseFieldDefs([{ label: "  ", field_type: "text" }]).ok).toBe(false)
    expect(parseFieldDefs([{ label: "X", field_type: "rating" }]).ok).toBe(false)
  })

  it("requires options on choice fields and forbids them elsewhere", () => {
    expect(parseFieldDefs([{ label: "Zone", field_type: "select" }]).ok).toBe(false)
    expect(
      parseFieldDefs([{ label: "Zone", field_type: "select", options: [] }]).ok,
    ).toBe(false)
    expect(
      parseFieldDefs([{ label: "T", field_type: "text", options: ["a"] }]).ok,
    ).toBe(false)
  })

  it("rejects blank and duplicate options", () => {
    expect(
      parseFieldDefs([{ label: "Z", field_type: "select", options: ["a", " "] }]).ok,
    ).toBe(false)
    expect(
      parseFieldDefs([{ label: "Z", field_type: "multiselect", options: ["a", "a"] }])
        .ok,
    ).toBe(false)
  })
})

describe("buildTemplateSnapshot / parseSnapshot round-trip", () => {
  it("freezes active fields sorted by sort_order and survives a round-trip", () => {
    const built = buildTemplateSnapshot(
      { id: "t-1", name: "Event Set Up", version: 3 },
      [
        {
          id: "b",
          label: "Second",
          field_type: "select",
          options: ["x", "y"],
          required: false,
          sort_order: 2,
        },
        {
          id: "a",
          label: "First",
          field_type: "text",
          options: null,
          required: true,
          sort_order: 1,
        },
      ],
    )
    expect(built.fields.map((f) => f.id)).toEqual(["a", "b"])
    expect(built.version).toBe(3)

    const reparsed = parseSnapshot(JSON.parse(JSON.stringify(built)))
    expect(reparsed).toEqual(built)
  })

  it("drops rows with unknown field types instead of poisoning the snapshot", () => {
    const built = buildTemplateSnapshot({ id: "t", name: "T", version: 1 }, [
      {
        id: "ok",
        label: "Fine",
        field_type: "text",
        options: null,
        required: false,
        sort_order: 0,
      },
      {
        id: "bad",
        label: "Bad",
        field_type: "hologram",
        options: null,
        required: false,
        sort_order: 1,
      },
    ])
    expect(built.fields.map((f) => f.id)).toEqual(["ok"])
  })

  it("parseSnapshot returns null for malformed stored values", () => {
    expect(parseSnapshot(null)).toBeNull()
    expect(parseSnapshot([])).toBeNull()
    expect(parseSnapshot({})).toBeNull()
    expect(
      parseSnapshot({
        template_id: "t",
        template_name: "T",
        version: 1,
        fields: [{ id: "x" }],
      }),
    ).toBeNull()
  })
})

describe("validateResponses", () => {
  it("rejects unknown field ids", () => {
    const res = validateResponses(snap([{ id: "a" }]), { zzz: "hi" }, "draft")
    expect(res.ok).toBe(false)
  })

  it("draft mode allows partial answers; submit mode enforces required", () => {
    const s = snap([
      { id: "a", label: "Event", field_type: "text", required: true },
      { id: "b", label: "Notes", field_type: "textarea", required: false },
    ])
    expect(validateResponses(s, {}, "draft").ok).toBe(true)
    const missing = validateResponses(s, {}, "submit")
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toContain("Event")
    expect(validateResponses(s, { a: "Hockey Night" }, "submit").ok).toBe(true)
  })

  it("validates numbers (accepting numeric strings) and rejects junk", () => {
    const s = snap([{ id: "n", label: "Count", field_type: "number" }])
    const good = validateResponses(s, { n: "42.5" }, "draft")
    expect(good.ok).toBe(true)
    if (good.ok) expect(good.responses.n).toBe(42.5)
    expect(validateResponses(s, { n: "abc" }, "draft").ok).toBe(false)
    expect(validateResponses(s, { n: Infinity }, "draft").ok).toBe(false)
  })

  it("select values must be listed options", () => {
    const s = snap([
      { id: "z", label: "Zone", field_type: "select", options: ["North", "South"] },
    ])
    expect(validateResponses(s, { z: "North" }, "draft").ok).toBe(true)
    expect(validateResponses(s, { z: "East" }, "draft").ok).toBe(false)
    expect(validateResponses(s, { z: 3 }, "draft").ok).toBe(false)
  })

  it("multiselect values must all be listed options and are deduped", () => {
    const s = snap([
      {
        id: "m",
        label: "Rinks",
        field_type: "multiselect",
        options: ["A", "B", "C"],
      },
    ])
    const good = validateResponses(s, { m: ["A", "B", "A"] }, "draft")
    expect(good.ok).toBe(true)
    if (good.ok) expect(good.responses.m).toEqual(["A", "B"])
    expect(validateResponses(s, { m: ["A", "Z"] }, "draft").ok).toBe(false)
    expect(validateResponses(s, { m: "A" }, "draft").ok).toBe(false)
  })

  it("a required checkbox must be true at submit, anything-boolean in draft", () => {
    const s = snap([
      { id: "c", label: "Nets secured", field_type: "checkbox", required: true },
    ])
    expect(validateResponses(s, { c: false }, "draft").ok).toBe(true)
    expect(validateResponses(s, { c: false }, "submit").ok).toBe(false)
    expect(validateResponses(s, {}, "submit").ok).toBe(false)
    expect(validateResponses(s, { c: true }, "submit").ok).toBe(true)
    expect(validateResponses(s, { c: "yes" }, "draft").ok).toBe(false)
  })

  it("validates time and date formats", () => {
    const s = snap([
      { id: "t", label: "Start", field_type: "time" },
      { id: "d", label: "Day", field_type: "date" },
    ])
    expect(validateResponses(s, { t: "14:30" }, "draft").ok).toBe(true)
    expect(validateResponses(s, { t: "24:30" }, "draft").ok).toBe(false)
    expect(validateResponses(s, { t: "2:30pm" }, "draft").ok).toBe(false)
    expect(validateResponses(s, { d: "2026-08-09" }, "draft").ok).toBe(true)
    expect(validateResponses(s, { d: "2026-02-30" }, "draft").ok).toBe(false)
    expect(validateResponses(s, { d: "08/09/2026" }, "draft").ok).toBe(false)
  })

  it("enforces text length caps and trims", () => {
    const s = snap([{ id: "a", label: "Event", field_type: "text" }])
    const long = "x".repeat(MAX_TEXT_LENGTH + 1)
    expect(validateResponses(s, { a: long }, "draft").ok).toBe(false)
    const good = validateResponses(s, { a: "  hi  " }, "draft")
    expect(good.ok).toBe(true)
    if (good.ok) expect(good.responses.a).toBe("hi")
  })

  it("rejects non-object payloads", () => {
    const s = snap([{ id: "a" }])
    expect(validateResponses(s, [], "draft").ok).toBe(false)
    expect(validateResponses(s, "x", "draft").ok).toBe(false)
    expect(validateResponses(s, null, "draft").ok).toBe(true) // treated as {}
  })
})

describe("parseTitle", () => {
  it("requires a non-blank, bounded title", () => {
    expect(parseTitle("  Friday Night Game  ")).toEqual({
      ok: true,
      title: "Friday Night Game",
    })
    expect(parseTitle("").ok).toBe(false)
    expect(parseTitle(undefined).ok).toBe(false)
    expect(parseTitle("x".repeat(201)).ok).toBe(false)
  })
})
