import { describe, expect, it } from "vitest"

import {
  buildInputFromObject,
  buildInputFromPayload,
  parseCircleResults,
  validateIceOpsInput,
  INVALID_CIRCLE_RESULTS,
  type IceOpsInput,
} from "./compute"
import { resolveEnabledOperationTypes } from "../types"

describe("resolveEnabledOperationTypes", () => {
  it("fails open to all operations for null/empty/invalid input", () => {
    const all = ["ice_make", "circle_check", "edging", "blade_change"]
    expect(resolveEnabledOperationTypes(null)).toEqual(all)
    expect(resolveEnabledOperationTypes([])).toEqual(all)
    expect(resolveEnabledOperationTypes(["nonsense"])).toEqual(all)
  })

  it("returns the configured subset in canonical tab order", () => {
    expect(
      resolveEnabledOperationTypes(["edging", "ice_make"]),
    ).toEqual(["ice_make", "edging"])
  })

  it("ignores unknown values mixed with valid ones", () => {
    expect(
      resolveEnabledOperationTypes(["blade_change", "bogus"]),
    ).toEqual(["blade_change"])
  })
})

// A valid occurred_at + ids reused across cases so individual assertions stay
// focused on the bit under test.
const OCCURRED = "2026-06-04T08:30"
const RINK = "rink-1"
const EQUIP = "equip-1"

function base(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    rink_id: RINK,
    equipment_id: EQUIP,
    occurred_at: OCCURRED,
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// buildInputFromObject — operation type discriminator
// ---------------------------------------------------------------------------

describe("buildInputFromObject (operation type discriminator)", () => {
  it("returns null for non-objects", () => {
    expect(buildInputFromObject(null)).toBeNull()
    expect(buildInputFromObject("nope")).toBeNull()
  })

  it("returns null when operation_type is missing or unknown", () => {
    expect(buildInputFromObject(base({}))).toBeNull()
    expect(buildInputFromObject(base({ operation_type: "bogus" }))).toBeNull()
  })

  it("honors an operation type hint over the object field", () => {
    const out = buildInputFromObject(base({ hours_run: "3" }), "edging")
    expect(out?.operation_type).toBe("edging")
    expect(out?.fields.type).toBe("edging")
  })

  it("keeps the raw occurred_at wall clock and trims string fields", () => {
    const out = buildInputFromObject(
      base({ operation_type: "edging", hours_run: "1", notes: "  hi  " }),
    )!
    expect(out.occurred_at).toBe(OCCURRED)
    expect(out.notes).toBe("hi")
    expect(out.rink_id).toBe(RINK)
  })

  it("null occurred_at when missing/invalid", () => {
    expect(
      buildInputFromObject({ operation_type: "edging", equipment_id: EQUIP })!
        .occurred_at,
    ).toBeNull()
    expect(
      buildInputFromObject({
        operation_type: "edging",
        equipment_id: EQUIP,
        occurred_at: "not-a-date",
      })!.occurred_at,
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Per-op-type payload parsing
// ---------------------------------------------------------------------------

describe("ice_make payload parsing", () => {
  it("coerces numeric strings and keeps time strings", () => {
    const out = buildInputFromObject(
      base({
        operation_type: "ice_make",
        water_used_gal: "120.5",
        machine_hours: "2",
        snow_taken_pct: "50",
        time_in: "08:00",
        time_out: "08:15",
      }),
    )!
    expect(out.fields).toEqual({
      type: "ice_make",
      water_used_gal: 120.5,
      machine_hours: 2,
      snow_taken_pct: 50,
      time_in: "08:00",
      time_out: "08:15",
    })
  })

  it("nulls blank/non-numeric values", () => {
    const out = buildInputFromObject(
      base({
        operation_type: "ice_make",
        water_used_gal: "",
        machine_hours: "abc",
      }),
    )!
    if (out.fields.type !== "ice_make") throw new Error("wrong type")
    expect(out.fields.water_used_gal).toBeNull()
    expect(out.fields.machine_hours).toBeNull()
    expect(out.fields.time_in).toBeNull()
  })
})

describe("edging payload parsing", () => {
  it("parses hours_run", () => {
    const out = buildInputFromObject(
      base({ operation_type: "edging", hours_run: 3.25 }),
    )!
    expect(out.fields).toEqual({ type: "edging", hours_run: 3.25 })
  })
})

describe("blade_change payload parsing", () => {
  it("parses serial, hours, and replaced_by", () => {
    const out = buildInputFromObject(
      base({
        operation_type: "blade_change",
        blade_serial: "  BL-9  ",
        hours_at_change: "400",
        replaced_by_employee_id: "emp-2",
      }),
    )!
    expect(out.fields).toEqual({
      type: "blade_change",
      blade_serial: "BL-9",
      hours_at_change: 400,
      replaced_by_employee_id: "emp-2",
    })
  })

  it("nulls empty serial / replaced_by", () => {
    const out = buildInputFromObject(
      base({ operation_type: "blade_change", blade_serial: "  " }),
    )!
    if (out.fields.type !== "blade_change") throw new Error("wrong type")
    expect(out.fields.blade_serial).toBeNull()
    expect(out.fields.replaced_by_employee_id).toBeNull()
  })
})

describe("circle_check payload parsing", () => {
  it("parses results from a parsed array, skipping label-less entries", () => {
    const out = buildInputFromObject(
      base({
        operation_type: "circle_check",
        circle_check_results: [
          { checklist_item_id: "i1", label_snapshot: "Lights", passed: true },
          {
            checklist_item_id: "i2",
            label_snapshot: "Brakes",
            passed: false,
            failed_notes: "  worn  ",
          },
          { label_snapshot: "", passed: true }, // dropped (no label)
        ],
      }),
    )!
    if (out.fields.type !== "circle_check") throw new Error("wrong type")
    expect(out.fields.results).toEqual([
      {
        checklist_item_id: "i1",
        label_snapshot: "Lights",
        passed: true,
        failed_notes: null,
      },
      {
        checklist_item_id: "i2",
        label_snapshot: "Brakes",
        passed: false,
        failed_notes: "worn",
      },
    ])
  })

  it("parses results from a JSON string (online hidden input)", () => {
    const out = buildInputFromObject(
      base({
        operation_type: "circle_check",
        circle_check_results: JSON.stringify([
          { label_snapshot: "Lights", passed: true },
        ]),
      }),
    )!
    if (out.fields.type !== "circle_check") throw new Error("wrong type")
    expect(out.fields.results).toHaveLength(1)
  })

  it("returns null when circle_check_results is not an array (the previously-opaque 'invalid results' case)", () => {
    expect(
      buildInputFromObject(
        base({
          operation_type: "circle_check",
          circle_check_results: { not: "an array" },
        }),
      ),
    ).toBeNull()
  })

  it("returns null when circle_check_results is malformed JSON", () => {
    expect(
      buildInputFromObject(
        base({
          operation_type: "circle_check",
          circle_check_results: "{ broken json",
        }),
      ),
    ).toBeNull()
  })

  it("treats missing circle_check_results (undefined) as the invalid case", () => {
    // No results key at all → not an array → null.
    expect(
      buildInputFromObject(base({ operation_type: "circle_check" })),
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// parseCircleResults — direct unit coverage of the sentinel
// ---------------------------------------------------------------------------

describe("parseCircleResults", () => {
  it("returns the sentinel for non-arrays", () => {
    expect(parseCircleResults(null)).toBe(INVALID_CIRCLE_RESULTS)
    expect(parseCircleResults({})).toBe(INVALID_CIRCLE_RESULTS)
    expect(parseCircleResults("x")).toBe(INVALID_CIRCLE_RESULTS)
  })

  it("returns an empty list for an empty array", () => {
    expect(parseCircleResults([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// buildInputFromPayload — offline entry point parity
// ---------------------------------------------------------------------------

describe("buildInputFromPayload", () => {
  it("reads operation_type from the payload object", () => {
    const out = buildInputFromPayload(
      base({ operation_type: "ice_make", water_used_gal: 10 }),
    )!
    expect(out.operation_type).toBe("ice_make")
    expect(out.fields.type).toBe("ice_make")
  })
})

// ---------------------------------------------------------------------------
// validateIceOpsInput — per-op-type validation
// ---------------------------------------------------------------------------

function input(partial: Partial<IceOpsInput> & { fields: IceOpsInput["fields"] }): IceOpsInput {
  return {
    operation_type: partial.fields.type,
    rink_id: RINK,
    equipment_id: EQUIP,
    occurred_at: new Date(OCCURRED).toISOString(),
    notes: null,
    ...partial,
  }
}

describe("validateIceOpsInput", () => {
  it("passes a valid ice_make submission", () => {
    expect(
      validateIceOpsInput(
        input({
          fields: {
            type: "ice_make",
            water_used_gal: 1,
            machine_hours: null,
            snow_taken_pct: null,
            time_in: null,
            time_out: null,
          },
        }),
      ),
    ).toBeNull()
  })

  it("requires a rink for ice_make (OPERATION_REQUIRES_RINK)", () => {
    expect(
      validateIceOpsInput(
        input({
          rink_id: null,
          fields: {
            type: "ice_make",
            water_used_gal: null,
            machine_hours: null,
            snow_taken_pct: null,
            time_in: null,
            time_out: null,
          },
        }),
      ),
    ).toBe("Please pick a rink.")
  })

  it("does NOT require a rink for edging", () => {
    expect(
      validateIceOpsInput(
        input({ rink_id: null, fields: { type: "edging", hours_run: 2 } }),
      ),
    ).toBeNull()
  })

  it("requires equipment for every op type", () => {
    expect(
      validateIceOpsInput(
        input({ equipment_id: null, fields: { type: "edging", hours_run: 2 } }),
      ),
    ).toBe("Please pick the equipment used.")
  })

  it("requires occurred_at", () => {
    expect(
      validateIceOpsInput(
        input({ occurred_at: null, fields: { type: "edging", hours_run: 2 } }),
      ),
    ).toBe("Please choose when the operation happened.")
  })

  it("rejects negative water/machine-hour values on ice_make", () => {
    const fields = {
      type: "ice_make",
      water_used_gal: -1,
      machine_hours: null,
      snow_taken_pct: null,
      time_in: null,
      time_out: null,
    } as const
    expect(validateIceOpsInput(input({ fields }))).toBe(
      "Water used and machine hours can't be negative.",
    )
    expect(
      validateIceOpsInput(
        input({ fields: { ...fields, water_used_gal: null, machine_hours: -0.5 } }),
      ),
    ).toBe("Water used and machine hours can't be negative.")
  })

  it("bounds snow_taken_pct to 0–100 (inclusive)", () => {
    const fields = {
      type: "ice_make",
      water_used_gal: null,
      machine_hours: null,
      snow_taken_pct: 101,
      time_in: null,
      time_out: null,
    } as const
    expect(validateIceOpsInput(input({ fields }))).toBe(
      "Snow taken must be between 0 and 100%.",
    )
    expect(
      validateIceOpsInput(input({ fields: { ...fields, snow_taken_pct: -1 } })),
    ).toBe("Snow taken must be between 0 and 100%.")
    expect(
      validateIceOpsInput(input({ fields: { ...fields, snow_taken_pct: 0 } })),
    ).toBeNull()
    expect(
      validateIceOpsInput(input({ fields: { ...fields, snow_taken_pct: 100 } })),
    ).toBeNull()
  })

  it("rejects negative hours_run on edging", () => {
    expect(
      validateIceOpsInput(input({ fields: { type: "edging", hours_run: -2 } })),
    ).toBe("Hours run can't be negative.")
  })

  it("rejects negative hours_at_change on blade_change", () => {
    expect(
      validateIceOpsInput(
        input({
          fields: {
            type: "blade_change",
            blade_serial: null,
            hours_at_change: -1,
            replaced_by_employee_id: null,
          },
        }),
      ),
    ).toBe("Blade hours can't be negative.")
  })

  it("rejects a circle check with no results (would read as a clean pass)", () => {
    expect(
      validateIceOpsInput(
        input({ rink_id: null, fields: { type: "circle_check", results: [] } }),
      ),
    ).toBe("Complete at least one checklist item.")
  })

  it("requires a note on each failed circle-check item", () => {
    expect(
      validateIceOpsInput(
        input({
          rink_id: null,
          fields: {
            type: "circle_check",
            results: [
              {
                checklist_item_id: "i1",
                label_snapshot: "Brakes",
                passed: false,
                failed_notes: null,
              },
            ],
          },
        }),
      ),
    ).toBe("Add a note explaining each failed checklist item.")
  })

  it("passes a circle-check with notes on failures (and no rink needed)", () => {
    expect(
      validateIceOpsInput(
        input({
          rink_id: null,
          fields: {
            type: "circle_check",
            results: [
              {
                checklist_item_id: "i1",
                label_snapshot: "Brakes",
                passed: false,
                failed_notes: "worn",
              },
              {
                checklist_item_id: "i2",
                label_snapshot: "Lights",
                passed: true,
                failed_notes: null,
              },
            ],
          },
        }),
      ),
    ).toBeNull()
  })
})
