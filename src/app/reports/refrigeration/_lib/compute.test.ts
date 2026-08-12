import { describe, expect, it } from "vitest"

import {
  buildComputedRows,
  buildEditChangeLogEntries,
  buildInputFromObject,
  evaluateComputed,
  followupKey,
  lookupThresholdRow,
  parseComputedSpec,
  planValueEdit,
  thresholdFlag,
  validateCriticalFollowups,
  validateRoundNo,
  type FieldConfigRow,
  type RowToInsert,
  type StoredValueRow,
  type ThresholdRow,
  type ValueEditPlan,
} from "./compute"

// ---------------------------------------------------------------------------
// validateRoundNo — readings-per-shift cap enforcement
// ---------------------------------------------------------------------------

describe("validateRoundNo", () => {
  it("accepts a null round number regardless of cap", () => {
    expect(validateRoundNo(null, null)).toBeNull()
    expect(validateRoundNo(null, 3)).toBeNull()
  })

  it("accepts any positive round when cap is unlimited (null)", () => {
    expect(validateRoundNo(1, null)).toBeNull()
    expect(validateRoundNo(50, null)).toBeNull()
  })

  it("rejects zero / negative / non-integer rounds", () => {
    expect(validateRoundNo(0, 3)).toMatch(/positive whole number/)
    expect(validateRoundNo(-1, 3)).toMatch(/positive whole number/)
    expect(validateRoundNo(1.5, 3)).toMatch(/positive whole number/)
  })

  it("accepts a round at or below the cap", () => {
    expect(validateRoundNo(1, 3)).toBeNull()
    expect(validateRoundNo(3, 3)).toBeNull()
  })

  it("rejects a round above the cap", () => {
    expect(validateRoundNo(4, 3)).toMatch(/cannot exceed the configured 3/)
  })
})

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

// ---------------------------------------------------------------------------
// Threshold helpers (shared by submit + recompute-on-edit)
// ---------------------------------------------------------------------------

describe("lookupThresholdRow / thresholdFlag", () => {
  const sectionLevel: ThresholdRow = {
    id: "t-section",
    field_id: "f1",
    equipment_id: null,
    min_value: -2,
    max_value: 2,
    severity: "warn",
  }
  const equipmentLevel: ThresholdRow = {
    ...sectionLevel,
    id: "t-equip",
    equipment_id: "e1",
    min_value: 0,
    max_value: 10,
  }

  it("prefers the equipment-scoped threshold, falling back to section-level", () => {
    const all = [sectionLevel, equipmentLevel]
    expect(lookupThresholdRow(all, "f1", "e1")?.id).toBe("t-equip")
    expect(lookupThresholdRow(all, "f1", "e2")?.id).toBe("t-section")
    expect(lookupThresholdRow(all, "f1", null)?.id).toBe("t-section")
    expect(lookupThresholdRow(all, "f9", null)).toBeNull()
  })

  it("flags out-of-range in BOTH directions and passes in-range values", () => {
    expect(thresholdFlag(sectionLevel, -3)).toMatchObject({
      isOor: true,
      thresholdId: "t-section",
      severity: "warn",
    })
    expect(thresholdFlag(sectionLevel, 3)).toMatchObject({ isOor: true })
    expect(thresholdFlag(sectionLevel, 0)).toMatchObject({
      isOor: false,
      thresholdId: "t-section",
    })
    expect(thresholdFlag(null, 999)).toMatchObject({
      isOor: false,
      thresholdId: null,
      severity: null,
    })
  })

  it("falls back to warn severity for unknown severity strings", () => {
    expect(
      thresholdFlag({ ...sectionLevel, severity: "warning" }, 5).severity,
    ).toBe("warn")
  })
})

// ---------------------------------------------------------------------------
// buildComputedRows config foot-gun logging (onSkip)
// ---------------------------------------------------------------------------

describe("buildComputedRows onSkip", () => {
  const base: FieldConfigRow = {
    id: "c1",
    section_id: "s1",
    equipment_id: null,
    key: "deviation",
    label: "Deviation",
    unit: "°F",
    field_type: "computed",
    options: { formula: "a-b", operands: { a: "temp", b: "setpoint" } },
  }
  const numericCfg = (id: string, key: string): FieldConfigRow => ({
    ...base,
    id,
    key,
    field_type: "numeric",
    options: [],
  })

  it("logs malformed computed options", () => {
    const skips: string[] = []
    const out = buildComputedRows(
      [{ ...base, options: { nope: true } }],
      [],
      new Map(),
      (_f, reason) => skips.push(reason),
    )
    expect(out).toHaveLength(0)
    expect(skips).toHaveLength(1)
    expect(skips[0]).toMatch(/invalid computed options/)
  })

  it("logs an operand key with no active field in the section", () => {
    const fieldById = new Map<string, FieldConfigRow>([
      ["ft", numericCfg("ft", "temp")],
      // no "setpoint" field configured
    ])
    const skips: string[] = []
    buildComputedRows(
      [base],
      [{ field_id: "ft", value_numeric: 24 }],
      fieldById,
      (_f, reason) => skips.push(reason),
    )
    expect(skips).toHaveLength(1)
    expect(skips[0]).toMatch(/"setpoint" does not match an active field/)
  })

  it("logs chaining onto another computed field", () => {
    const other: FieldConfigRow = { ...base, id: "c2", key: "setpoint" } // computed
    const fieldById = new Map<string, FieldConfigRow>([
      ["ft", numericCfg("ft", "temp")],
      ["c2", other],
    ])
    const skips: string[] = []
    buildComputedRows(
      [base],
      [{ field_id: "ft", value_numeric: 24 }],
      fieldById,
      (_f, reason) => skips.push(reason),
    )
    expect(skips).toHaveLength(1)
    expect(skips[0]).toMatch(/chaining is unsupported/)
  })

  it("does NOT log when config is sound but a value simply wasn't entered", () => {
    const fieldById = new Map<string, FieldConfigRow>([
      ["ft", numericCfg("ft", "temp")],
      ["fs", numericCfg("fs", "setpoint")],
    ])
    const skips: string[] = []
    const out = buildComputedRows(
      [base],
      [{ field_id: "ft", value_numeric: 24 }], // setpoint left blank
      fieldById,
      (_f, reason) => skips.push(reason),
    )
    expect(out).toHaveLength(0)
    expect(skips).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// planValueEdit — admin correction + recompute-on-edit
// ---------------------------------------------------------------------------

describe("planValueEdit", () => {
  // Config mirrors the seeded Tennity supply/return deviation setup:
  // cold_floor_temp − cold_floor_setpoint, threshold −2…2 warn.
  const fTemp: FieldConfigRow = {
    id: "f-temp",
    section_id: "s-sr",
    equipment_id: null,
    key: "cold_floor_temp_main",
    label: "Cold floor temp (Main)",
    unit: "°F",
    field_type: "numeric",
    options: [],
  }
  const fSet: FieldConfigRow = {
    ...fTemp,
    id: "f-set",
    key: "cold_floor_setpoint_main",
    label: "Cold floor set point (Main)",
  }
  const fDev: FieldConfigRow = {
    ...fTemp,
    id: "f-dev",
    key: "cold_floor_deviation_main",
    label: "Cold floor deviation from set point (Main)",
    field_type: "computed",
    options: {
      formula: "a-b",
      operands: { a: "cold_floor_temp_main", b: "cold_floor_setpoint_main" },
    },
  }
  const fields = [fTemp, fSet, fDev]
  const thresholds: ThresholdRow[] = [
    {
      id: "t-dev",
      field_id: "f-dev",
      equipment_id: null,
      min_value: -2,
      max_value: 2,
      severity: "warn",
    },
  ]

  const stored = (over: Partial<StoredValueRow>): StoredValueRow => ({
    id: "v-x",
    field_id: null,
    equipment_id: null,
    label_snapshot: "",
    field_type_snapshot: "numeric",
    unit_snapshot: "°F",
    value_numeric: null,
    is_out_of_range: false,
    threshold_id: null,
    ...over,
  })

  const vTemp = stored({
    id: "v-temp",
    field_id: "f-temp",
    label_snapshot: fTemp.label,
    value_numeric: 24,
  })
  const vSet = stored({
    id: "v-set",
    field_id: "f-set",
    label_snapshot: fSet.label,
    value_numeric: 21,
  })
  const vDev = stored({
    id: "v-dev",
    field_id: "f-dev",
    label_snapshot: fDev.label,
    field_type_snapshot: "computed",
    value_numeric: 3,
    is_out_of_range: true,
    threshold_id: "t-dev",
  })

  it("recomputes the dependent deviation and clears its flag (24/21→3 OOR, setpoint→23 ⇒ 1 OK)", () => {
    const res = planValueEdit({
      editedRow: vSet,
      newValue: 23,
      reportValues: [vTemp, vSet, vDev],
      fields,
      thresholds,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.plan.edited).toMatchObject({
      id: "v-set",
      value_numeric: 23,
      is_out_of_range: false,
      before: { value_numeric: 21 },
    })
    expect(res.plan.recomputed).toHaveLength(1)
    expect(res.plan.recomputed[0]).toMatchObject({
      id: "v-dev",
      value_numeric: 1,
      is_out_of_range: false,
      threshold_id: "t-dev",
      before: { value_numeric: 3, is_out_of_range: true },
    })
  })

  it("flags the recomputed value when the edit pushes it out of range (both directions)", () => {
    const high = planValueEdit({
      editedRow: vTemp,
      newValue: 30, // deviation 9 > max 2
      reportValues: [vTemp, vSet, vDev],
      fields,
      thresholds,
    })
    expect(high.ok && high.plan.recomputed[0]).toMatchObject({
      value_numeric: 9,
      is_out_of_range: true,
    })
    const low = planValueEdit({
      editedRow: vTemp,
      newValue: 15, // deviation −6 < min −2
      reportValues: [vTemp, vSet, vDev],
      fields,
      thresholds,
    })
    expect(low.ok && low.plan.recomputed[0]).toMatchObject({
      value_numeric: -6,
      is_out_of_range: true,
    })
  })

  it("re-checks the edited value's own threshold in both directions", () => {
    const tThresh: ThresholdRow = {
      id: "t-temp",
      field_id: "f-temp",
      equipment_id: null,
      min_value: 18,
      max_value: 26,
      severity: "warn",
    }
    const below = planValueEdit({
      editedRow: vTemp,
      newValue: 10,
      reportValues: [vTemp],
      fields,
      thresholds: [tThresh],
    })
    expect(below.ok && below.plan.edited).toMatchObject({
      is_out_of_range: true,
      threshold_id: "t-temp",
    })
    const inside = planValueEdit({
      editedRow: vTemp,
      newValue: 22,
      reportValues: [vTemp],
      fields,
      thresholds: [tThresh],
    })
    expect(inside.ok && inside.plan.edited).toMatchObject({
      is_out_of_range: false,
      threshold_id: "t-temp",
    })
  })

  it("plans an INSERT when the computed row did not exist at submit time", () => {
    const res = planValueEdit({
      editedRow: vTemp,
      newValue: 22,
      reportValues: [vTemp, vSet], // no v-dev row
      fields,
      thresholds,
    })
    expect(res.ok && res.plan.recomputed[0]).toMatchObject({
      id: null,
      value_numeric: 1,
      is_out_of_range: false,
      before: null,
    })
  })

  it("rejects editing a computed value directly", () => {
    const res = planValueEdit({
      editedRow: vDev,
      newValue: 0,
      reportValues: [vTemp, vSet, vDev],
      fields,
      thresholds,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/cannot be edited directly/i)
  })

  it("rejects non-numeric readings and non-finite values", () => {
    const sel = planValueEdit({
      editedRow: stored({ id: "v-s", field_type_snapshot: "select" }),
      newValue: 1,
      reportValues: [],
      fields,
      thresholds,
    })
    expect(sel.ok).toBe(false)
    const nan = planValueEdit({
      editedRow: vTemp,
      newValue: Number.NaN,
      reportValues: [vTemp],
      fields,
      thresholds,
    })
    expect(nan.ok).toBe(false)
  })

  it("leaves computed fields alone when the edited key is not an operand", () => {
    const fFlow: FieldConfigRow = {
      ...fTemp,
      id: "f-flow",
      key: "brine_flow",
      label: "Brine flow",
      unit: "gpm",
    }
    const vFlow = stored({
      id: "v-flow",
      field_id: "f-flow",
      label_snapshot: "Brine flow",
      value_numeric: 100,
    })
    const res = planValueEdit({
      editedRow: vFlow,
      newValue: 120,
      reportValues: [vFlow, vTemp, vSet, vDev],
      fields: [...fields, fFlow],
      thresholds,
    })
    expect(res.ok && res.plan.recomputed).toEqual([])
  })

  it("surfaces config problems in plan.skipped instead of computing", () => {
    const chained: FieldConfigRow = {
      ...fDev,
      id: "f-chain",
      key: "chained",
      options: {
        formula: "a-b",
        // depends on the edited key AND on another computed field
        operands: { a: "cold_floor_temp_main", b: "cold_floor_deviation_main" },
      },
    }
    const res = planValueEdit({
      editedRow: vTemp,
      newValue: 25,
      reportValues: [vTemp, vSet, vDev],
      fields: [...fields, chained],
      thresholds,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.plan.skipped.map((s) => s.field.id)).toContain("f-chain")
    expect(res.plan.skipped[0].reason).toMatch(/chaining is unsupported/)
  })
})

// ---------------------------------------------------------------------------
// buildEditChangeLogEntries — audit rows for an applied plan
// ---------------------------------------------------------------------------

describe("buildEditChangeLogEntries", () => {
  it("emits the source-edit entry plus one recompute entry with the fixed reason", () => {
    const plan: ValueEditPlan = {
      edited: {
        id: "v-set",
        value_numeric: 23,
        is_out_of_range: false,
        threshold_id: null,
        before: { value_numeric: 21, is_out_of_range: false },
      },
      recomputed: [
        {
          id: "v-dev",
          field: {
            id: "f-dev",
            section_id: "s-sr",
            equipment_id: null,
            key: "cold_floor_deviation_main",
            label: "Cold floor deviation from set point (Main)",
            unit: "°F",
            field_type: "computed",
            options: {},
          },
          value_numeric: 1,
          is_out_of_range: false,
          threshold_id: "t-dev",
          before: { value_numeric: 3, is_out_of_range: true },
        },
      ],
      skipped: [],
    }
    const entries = buildEditChangeLogEntries(plan, {
      facilityId: "fac-1",
      reportId: "rep-1",
      changedBy: "emp-1",
      reason: "typo: transposed digits",
      editedLabel: "Cold floor set point (Main)",
    })
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      facility_id: "fac-1",
      report_id: "rep-1",
      changed_by: "emp-1",
      reason: "typo: transposed digits",
      before: { value_numeric: 21 },
      after: { value_numeric: 23 },
    })
    expect(entries[1]).toMatchObject({
      reason: "recomputed: source value edited",
      before: { value_numeric: 3, is_out_of_range: true },
      after: { value_numeric: 1, is_out_of_range: false },
    })
  })
})
