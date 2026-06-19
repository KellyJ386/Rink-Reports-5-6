import { describe, expect, it } from "vitest"

import {
  buildInputFromForm,
  buildInputFromPayload,
  DESCRIPTION_MAX,
  MAX_WITNESSES,
  validateIncidentInput,
  type IncidentInput,
} from "./compute"

function validInput(overrides: Partial<IncidentInput> = {}): IncidentInput {
  return {
    reporter_name: "Pat Reporter",
    reporter_phone: "555-0100",
    description: "Skater collided with the boards.",
    occurred_at: "2026-06-08T14:30",
    severity_level_id: "sev-1",
    activity_id: "",
    activity_other: "",
    location_other: "",
    immediate_actions: "",
    space_ids: ["space-1"],
    witnesses: [],
    witnessMissingContact: false,
    ambulance_flag: false,
    persons_involved: null,
    follow_up_required: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// buildInputFromPayload — untrusted offline JSON
// ---------------------------------------------------------------------------

describe("buildInputFromPayload", () => {
  it("returns null for non-objects", () => {
    expect(buildInputFromPayload(null)).toBeNull()
    expect(buildInputFromPayload("nope")).toBeNull()
    expect(buildInputFromPayload(42)).toBeNull()
  })

  it("coerces missing/non-string fields to empty strings", () => {
    const out = buildInputFromPayload({ description: null })!
    expect(out.description).toBe("")
    expect(out.space_ids).toEqual([])
    expect(out.witnesses).toEqual([])
  })

  it("ignores any reporter identity in the payload (sourced from login)", () => {
    const out = buildInputFromPayload({
      reporter_name: "  Spoofed  ",
      reporter_phone: "555-9999",
    })!
    expect(out.reporter_name).toBe("")
    expect(out.reporter_phone).toBe("")
  })

  it("trims string fields", () => {
    const out = buildInputFromPayload({ description: "  desc  " })!
    expect(out.description).toBe("desc")
  })

  it("dedupes and trims space ids, dropping non-strings and blanks", () => {
    const out = buildInputFromPayload({
      space_ids: [" a ", "a", "b", "", 3, null],
    })!
    expect(out.space_ids).toEqual(["a", "b"])
  })

  it("caps witnesses at MAX_WITNESSES", () => {
    const witnesses = Array.from({ length: 5 }, (_, i) => ({
      name: `W${i}`,
      phone: "555",
    }))
    const out = buildInputFromPayload({ witnesses })!
    expect(out.witnesses).toHaveLength(MAX_WITNESSES)
  })

  it("skips nameless witnesses without flagging missing contact", () => {
    const out = buildInputFromPayload({
      witnesses: [{ name: "", phone: "555" }, { name: "Ann", email: "a@b.c" }],
    })!
    expect(out.witnesses).toEqual([
      { name: "Ann", phone: null, email: "a@b.c", statement: null },
    ])
    expect(out.witnessMissingContact).toBe(false)
  })

  it("flags (and drops) a named witness with no phone and no email", () => {
    const out = buildInputFromPayload({
      witnesses: [{ name: "Ann" }],
    })!
    expect(out.witnesses).toEqual([])
    expect(out.witnessMissingContact).toBe(true)
  })

  it("nulls empty witness contact subfields", () => {
    const out = buildInputFromPayload({
      witnesses: [{ name: "Ann", phone: " 555 ", email: "", statement: "  " }],
    })!
    expect(out.witnesses).toEqual([
      { name: "Ann", phone: "555", email: null, statement: null },
    ])
  })

  it("defaults the new escalation fields when absent", () => {
    const out = buildInputFromPayload({ reporter_name: "Pat" })!
    expect(out.ambulance_flag).toBe(false)
    expect(out.persons_involved).toBeNull()
    expect(out.follow_up_required).toBe(false)
  })

  it("coerces booleans and an integer count from the payload", () => {
    const out = buildInputFromPayload({
      ambulance_flag: true,
      persons_involved: 3,
      follow_up_required: "true",
    })!
    expect(out.ambulance_flag).toBe(true)
    expect(out.persons_involved).toBe(3)
    expect(out.follow_up_required).toBe(true)
  })

  it("treats a blank count as null and a bad count as NaN", () => {
    expect(buildInputFromPayload({ persons_involved: "" })!.persons_involved).toBeNull()
    expect(
      Number.isNaN(buildInputFromPayload({ persons_involved: -1 })!.persons_involved),
    ).toBe(true)
    expect(
      Number.isNaN(buildInputFromPayload({ persons_involved: "1.5" })!.persons_involved),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// buildInputFromForm — online FormData path
// ---------------------------------------------------------------------------

describe("buildInputFromForm", () => {
  it("parses fields, witnesses_json, and spaces_json", () => {
    const fd = new FormData()
    fd.set("description", "desc")
    fd.set("occurred_at", "2026-06-08T14:30")
    fd.set("severity_level_id", "sev-1")
    fd.set(
      "witnesses_json",
      JSON.stringify([{ name: "Ann", phone: "555" }]),
    )
    fd.set("spaces_json", JSON.stringify(["s1", "s1", "s2"]))
    fd.set("ambulance_flag", "true")
    fd.set("persons_involved", "2")
    fd.set("follow_up_required", "false")

    const out = buildInputFromForm(fd)
    // Reporter identity is never read from the form — injected server-side.
    expect(out.reporter_name).toBe("")
    expect(out.reporter_phone).toBe("")
    expect(out.ambulance_flag).toBe(true)
    expect(out.persons_involved).toBe(2)
    expect(out.follow_up_required).toBe(false)
    expect(out.witnesses).toEqual([
      { name: "Ann", phone: "555", email: null, statement: null },
    ])
    expect(out.space_ids).toEqual(["s1", "s2"])
  })

  it("tolerates malformed JSON in the hidden fields", () => {
    const fd = new FormData()
    fd.set("witnesses_json", "{not json")
    fd.set("spaces_json", "also not json")
    const out = buildInputFromForm(fd)
    expect(out.witnesses).toEqual([])
    expect(out.space_ids).toEqual([])
    expect(out.witnessMissingContact).toBe(false)
  })

  it("online (form) and offline (payload) parse to the same shape", () => {
    const fd = new FormData()
    fd.set("description", "desc")
    fd.set("occurred_at", "2026-06-08T14:30")
    fd.set("severity_level_id", "sev-1")
    fd.set("witnesses_json", JSON.stringify([{ name: "Ann", phone: "5" }]))
    fd.set("spaces_json", JSON.stringify(["s1"]))

    const fromForm = buildInputFromForm(fd)
    const fromPayload = buildInputFromPayload({
      description: "desc",
      occurred_at: "2026-06-08T14:30",
      severity_level_id: "sev-1",
      witnesses: [{ name: "Ann", phone: "5" }],
      space_ids: ["s1"],
    })
    expect(fromPayload).toEqual(fromForm)
  })
})

// ---------------------------------------------------------------------------
// validateIncidentInput
// ---------------------------------------------------------------------------

describe("validateIncidentInput", () => {
  it("passes a fully-valid input", () => {
    const { fieldErrors, error } = validateIncidentInput(validInput())
    expect(fieldErrors).toEqual({})
    expect(error).toBeUndefined()
  })

  it("requires every core field", () => {
    const { fieldErrors } = validateIncidentInput(
      validInput({
        occurred_at: "",
        severity_level_id: "",
        description: "",
      }),
    )
    expect(Object.keys(fieldErrors).sort()).toEqual([
      "description",
      "occurred_at",
      "severity_level_id",
    ])
  })

  it("rejects an unparseable occurred_at", () => {
    const { fieldErrors } = validateIncidentInput(
      validInput({ occurred_at: "not-a-date" }),
    )
    expect(fieldErrors.occurred_at).toBe("Invalid date and time.")
  })

  it("rejects an over-long description, accepts one at the limit", () => {
    const atLimit = validateIncidentInput(
      validInput({ description: "x".repeat(DESCRIPTION_MAX) }),
    )
    expect(atLimit.fieldErrors.description).toBeUndefined()

    const over = validateIncidentInput(
      validInput({ description: "x".repeat(DESCRIPTION_MAX + 1) }),
    )
    expect(over.fieldErrors.description).toContain(`${DESCRIPTION_MAX}`)
  })

  it("surfaces the witness-contact error", () => {
    const { error } = validateIncidentInput(
      validInput({ witnessMissingContact: true }),
    )
    expect(error).toMatch(/witness/i)
  })

  it("requires a space or an Other location", () => {
    const missing = validateIncidentInput(
      validInput({ space_ids: [], location_other: "" }),
    )
    expect(missing.error).toMatch(/facility space/i)

    const withOther = validateIncidentInput(
      validInput({ space_ids: [], location_other: "Parking lot" }),
    )
    expect(withOther.error).toBeUndefined()
  })

  it("accepts a null/valid persons_involved, rejects a NaN one", () => {
    expect(
      validateIncidentInput(validInput({ persons_involved: null })).fieldErrors
        .persons_involved,
    ).toBeUndefined()
    expect(
      validateIncidentInput(validInput({ persons_involved: 0 })).fieldErrors
        .persons_involved,
    ).toBeUndefined()
    expect(
      validateIncidentInput(validInput({ persons_involved: Number.NaN }))
        .fieldErrors.persons_involved,
    ).toBeDefined()
  })

  it("witness-contact error takes precedence over the space error", () => {
    const { error } = validateIncidentInput(
      validInput({
        witnessMissingContact: true,
        space_ids: [],
        location_other: "",
      }),
    )
    expect(error).toMatch(/witness/i)
  })
})
