import { describe, expect, it } from "vitest"

import {
  buildComputedRows,
  buildInputFromObject,
  evaluateComputed,
  followupKey,
  parseComputedSpec,
  validateCriticalFollowups,
  type FieldConfigRow,
  type RowToInsert,
} from "./compute"

// ---------------------------------------------------------------------------
// buildInputFromObject — payload parsing + cadence default
// ---------------------------------------------------------------------------

describe("buildInputFromObject", () => {
  it("returns null for non-objects", () => {
    expect(buildInputFromObject(null)).toBeNull()
    expect(buildInputFromObject("nope")).toBeNull()
  })

  it("defaults reading_at to null when missing or invalid (server fills now())", () => {
    expect(buildInputFromObject({})!.reading_at).toBeNull()
    expect(buildInputFromObject({ reading_at: "not-a-date" })!.reading_at).toBeNull()
  })

  it("normalizes a valid reading_at to ISO", () => {
    const out = buildInputFromObject({ reading_at: "2026-06-04T08:30" })!
    expect(out.reading_at).toBe(new Date("2026-06-04T08:30").toISOString())
  })

  it("parses shift and integer round_no, rejecting non-integers", () => {
    expect(buildInputFromObject({ shift: "  AM ", round_no: "2" })).toMatchObject({
      shift: "AM",
      round_no: 2,
    })
    expect(buildInputFromObject({ round_no: 1.5 })!.round_no).toBeNull()
    expect(buildInputFromObject({ shift: "   " })!.shift).toBeNull()
  })

  it("drops client-supplied computed values (derived server-side only)", () => {
    const out = buildInputFromObject({
      values: [
        {
          field_id: "f1",
          field_type_snapshot: "computed",
          value_numeric: 99,
        },
        {
          field_id: "f2",
          field_type_snapshot: "numeric",
          value_numeric: 12,
        },
      ],
    })!
    expect(out.values).toHaveLength(1)
    expect(out.values[0].field_id).toBe("f2")
  })

  it("parses followups, dropping entries without a field_id or body", () => {
    const out = buildInputFromObject({
      followups: [
        { field_id: "f1", equipment_id: "e1", body: " did x " },
        { field_id: "f2", body: "" },
        { equipment_id: "e3", body: "orphan" },
      ],
    })!
    expect(out.followups).toEqual([
      { field_id: "f1", equipment_id: "e1", body: "did x" },
    ])
  })

  it("online (form) and offline (payload) parse to the same shape", async () => {
    const obj = {
      reading_at: "2026-06-04T08:30",
      values: [
        { field_id: "f2", field_type_snapshot: "numeric", value_numeric: 12 },
      ],
      followups: [{ field_id: "f2", equipment_id: null, body: "ok" }],
    }
    const { buildInputFromForm, buildInputFromPayload } = await import("./compute")
    const fd = new FormData()
    fd.set("values_json", JSON.stringify(obj))
    expect(buildInputFromForm(fd)).toEqual(buildInputFromPayload(obj))
  })
})

// ---------------------------------------------------------------------------
// Computed-field evaluator
// ---------------------------------------------------------------------------

describe("parseComputedSpec / evaluateComputed", () => {
  it("parses the documented a-b schema", () => {
    expect(
      parseComputedSpec({
        formula: "a-b",
        operands: { a: "x", b: "y" },
      }),
    ).toEqual({ operator: "-", a: "x", b: "y" })
  })

  it("accepts +, -, *, / with surrounding whitespace", () => {
    for (const op of ["+", "-", "*", "/"] as const) {
      expect(
        parseComputedSpec({ formula: `a ${op} b`, operands: { a: "x", b: "y" } }),
      ).toMatchObject({ operator: op })
    }
  })

  it("rejects unknown operators and malformed formulas", () => {
    expect(parseComputedSpec({ formula: "a^b", operands: { a: "x", b: "y" } })).toBeNull()
    expect(parseComputedSpec({ formula: "a-b-c", operands: { a: "x", b: "y" } })).toBeNull()
    expect(parseComputedSpec({ formula: "drop table", operands: {} })).toBeNull()
    expect(parseComputedSpec({ formula: "a-b" })).toBeNull()
  })

  it("evaluates arithmetic and guards divide-by-zero / missing operands", () => {
    const spec = parseComputedSpec({ formula: "a-b", operands: { a: "x", b: "y" } })!
    expect(evaluateComputed(spec, (k) => ({ x: 10, y: 3 })[k] ?? null)).toBe(7)
    const div = parseComputedSpec({ formula: "a/b", operands: { a: "x", b: "y" } })!
    expect(evaluateComputed(div, (k) => ({ x: 10, y: 0 })[k] ?? null)).toBeNull()
    expect(evaluateComputed(spec, () => null)).toBeNull()
  })
})

describe("buildComputedRows", () => {
  const computed: FieldConfigRow = {
    id: "c1",
    section_id: "s1",
    equipment_id: null,
    key: "dew_point_spread",
    label: "Dew-point spread",
    unit: "°F",
    field_type: "computed",
    options: { formula: "a-b", operands: { a: "supply", b: "ret" } },
  }
  const fieldById = new Map<string, FieldConfigRow>([
    ["fa", { ...computed, id: "fa", key: "supply", field_type: "numeric" }],
    ["fb", { ...computed, id: "fb", key: "ret", field_type: "numeric" }],
  ])

  it("derives a value from same-section operands by key", () => {
    const out = buildComputedRows(
      [computed],
      [
        { field_id: "fa", value_numeric: 20 },
        { field_id: "fb", value_numeric: 14 },
      ],
      fieldById,
    )
    expect(out).toHaveLength(1)
    expect(out[0].value).toBe(6)
  })

  it("skips computed fields whose operands are absent", () => {
    const out = buildComputedRows(
      [computed],
      [{ field_id: "fa", value_numeric: 20 }],
      fieldById,
    )
    expect(out).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Critical-out-of-range corrective-action guard
// ---------------------------------------------------------------------------

describe("validateCriticalFollowups", () => {
  const baseRow = (over: Partial<RowToInsert>): RowToInsert => ({
    facility_id: "fac",
    report_id: "rep",
    field_id: "f1",
    equipment_id: null,
    label_snapshot: "Gas detection",
    equipment_name_snapshot: null,
    field_type_snapshot: "numeric",
    unit_snapshot: "ppm",
    value_text: null,
    value_numeric: 30,
    value_boolean: null,
    threshold_id: "t1",
    is_out_of_range: true,
    _severity: "critical",
    ...over,
  })

  it("fails when a critical OOR reading has no matching note", () => {
    const err = validateCriticalFollowups([baseRow({})], [])
    expect(err).toMatch(/corrective-action note is required/i)
    expect(err).toContain("Gas detection")
  })

  it("passes when a matching note is present (by field + equipment)", () => {
    const err = validateCriticalFollowups(
      [baseRow({ equipment_id: "e9" })],
      [{ field_id: "f1", equipment_id: "e9", body: "vented" }],
    )
    expect(err).toBeNull()
  })

  it("ignores non-critical or in-range readings", () => {
    expect(
      validateCriticalFollowups([baseRow({ _severity: "warn" })], []),
    ).toBeNull()
    expect(
      validateCriticalFollowups([baseRow({ is_out_of_range: false })], []),
    ).toBeNull()
  })

  it("keys notes by field + equipment so a mismatched equipment does not satisfy it", () => {
    const err = validateCriticalFollowups(
      [baseRow({ equipment_id: "e1" })],
      [{ field_id: "f1", equipment_id: "e2", body: "wrong unit" }],
    )
    expect(err).not.toBeNull()
  })

  it("followupKey is stable for null equipment", () => {
    expect(followupKey("f1", null)).toBe("f1::null")
    expect(followupKey("f1", "e1")).toBe("f1::e1")
  })
})
