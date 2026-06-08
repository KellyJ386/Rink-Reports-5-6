import { describe, expect, it } from "vitest"

import {
  buildInputFromForm,
  buildInputFromPayload,
  normalizeBodyParts,
  normalizeWitnesses,
  parseBodyParts,
  parseWitnesses,
  severityKeyToAlertSeverity,
  validateFields,
  type AccidentInput,
} from "./compute"

// ---------------------------------------------------------------------------
// Body-part parsing
// ---------------------------------------------------------------------------

describe("parseBodyParts / normalizeBodyParts", () => {
  it("returns [] for empty, malformed, or non-array input", () => {
    expect(parseBodyParts("")).toEqual([])
    expect(parseBodyParts("   ")).toEqual([])
    expect(parseBodyParts("{not json")).toEqual([])
    expect(parseBodyParts(JSON.stringify({ a: 1 }))).toEqual([])
    expect(normalizeBodyParts("nope")).toEqual([])
  })

  it("keeps valid rows and drops rows with side 'none' or missing id", () => {
    const out = parseBodyParts(
      JSON.stringify([
        { body_part_dropdown_id: "head", side: "front", laterality: null },
        { body_part_dropdown_id: "arm", side: "none", laterality: "left" },
        { side: "back" },
      ]),
    )
    expect(out).toEqual([
      { body_part_dropdown_id: "head", side: "front", laterality: null },
    ])
  })

  it("rejects unknown side and unknown laterality strings", () => {
    expect(
      normalizeBodyParts([
        { body_part_dropdown_id: "x", side: "sideways", laterality: null },
        { body_part_dropdown_id: "y", side: "front", laterality: "middle" },
      ]),
    ).toEqual([])
  })

  it("accepts left/right laterality for paired regions", () => {
    const out = normalizeBodyParts([
      { body_part_dropdown_id: "arm", side: "front", laterality: "left" },
      { body_part_dropdown_id: "arm", side: "front", laterality: "right" },
    ])
    expect(out).toHaveLength(2)
  })

  it("dedupes on (region, laterality), keeping the first occurrence", () => {
    const out = normalizeBodyParts([
      { body_part_dropdown_id: "arm", side: "front", laterality: "left" },
      { body_part_dropdown_id: "arm", side: "back", laterality: "left" },
    ])
    expect(out).toEqual([
      { body_part_dropdown_id: "arm", side: "front", laterality: "left" },
    ])
  })

  it("caps the number of body parts at the maximum", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      body_part_dropdown_id: `bp-${i}`,
      side: "front",
      laterality: null,
    }))
    expect(normalizeBodyParts(many)).toHaveLength(32)
  })
})

// ---------------------------------------------------------------------------
// Witness parsing
// ---------------------------------------------------------------------------

describe("parseWitnesses / normalizeWitnesses", () => {
  it("trims fields, nulls empty contact/statement, and drops nameless rows", () => {
    const out = parseWitnesses(
      JSON.stringify([
        { name: "  Jane  ", contact: " 555 ", statement: "" },
        { name: "", contact: "x" },
        { contact: "orphan" },
      ]),
    )
    expect(out).toEqual([{ name: "Jane", contact: "555", statement: null }])
  })

  it("caps witnesses at the maximum", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `W${i}` }))
    expect(normalizeWitnesses(many)).toHaveLength(5)
  })

  it("returns [] for malformed JSON", () => {
    expect(parseWitnesses("{bad")).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Input builders — online (FormData) vs offline (payload) parity
// ---------------------------------------------------------------------------

describe("buildInputFromForm / buildInputFromPayload", () => {
  const bodyParts = [
    { body_part_dropdown_id: "head", side: "front", laterality: null },
  ]
  const witnesses = [{ name: "Jane", contact: "555", statement: "saw it" }]

  function fullForm(): FormData {
    const fd = new FormData()
    fd.set("injured_person_name", "  John Doe  ")
    fd.set("injured_person_contact", " 555-1234 ")
    fd.set("injured_person_age", "37.9")
    fd.set("description", "  slipped on ice  ")
    fd.set("occurred_at", "2026-06-04T08:30")
    fd.set("location_dropdown_id", "loc-1")
    fd.set("activity_dropdown_id", "")
    fd.set("severity_dropdown_id", "sev-1")
    fd.set("medical_attention_dropdown_id", "med-1")
    fd.set("primary_injury_type_dropdown_id", "inj-1")
    fd.set("workers_comp", "on")
    fd.set("workers_comp_ack", "on")
    fd.set("body_parts_json", JSON.stringify(bodyParts))
    fd.set("witnesses_json", JSON.stringify(witnesses))
    return fd
  }

  it("parses, trims, and truncates age from FormData", () => {
    const input = buildInputFromForm(fullForm())
    expect(input).toMatchObject({
      injured_person_name: "John Doe",
      injured_person_contact: "555-1234",
      injured_person_age: 37,
      description: "slipped on ice",
      occurred_at: "2026-06-04T08:30",
      location_dropdown_id: "loc-1",
      activity_dropdown_id: null,
      workers_comp: true,
      workers_comp_ack: true,
    })
    expect(input.body_parts).toEqual(bodyParts)
    expect(input.witnesses).toEqual(witnesses)
  })

  it("treats missing age and unchecked checkboxes correctly", () => {
    const fd = new FormData()
    fd.set("injured_person_name", "X")
    const input = buildInputFromForm(fd)
    expect(input.injured_person_age).toBeNull()
    expect(input.workers_comp).toBe(false)
    expect(input.workers_comp_ack).toBe(false)
    expect(input.occurred_at).toBe("")
  })

  it("offline payload parses to the same shape as the online form", () => {
    const payload = {
      injured_person_name: "  John Doe  ",
      injured_person_contact: " 555-1234 ",
      injured_person_age: "37.9",
      description: "  slipped on ice  ",
      occurred_at: "2026-06-04T08:30",
      location_dropdown_id: "loc-1",
      activity_dropdown_id: "",
      severity_dropdown_id: "sev-1",
      medical_attention_dropdown_id: "med-1",
      primary_injury_type_dropdown_id: "inj-1",
      workers_comp: "on",
      workers_comp_ack: "on",
      body_parts: bodyParts,
      witnesses,
    }
    expect(buildInputFromPayload(payload)).toEqual(buildInputFromForm(fullForm()))
  })

  it("accepts boolean flags and JSON-string arrays in the offline payload", () => {
    const input = buildInputFromPayload({
      injured_person_name: "Jane",
      injured_person_contact: "c",
      injured_person_age: 30,
      description: "d",
      occurred_at: "2026-06-04T08:30",
      workers_comp: true,
      workers_comp_ack: false,
      body_parts: JSON.stringify(bodyParts),
      witnesses: JSON.stringify(witnesses),
    })!
    expect(input.workers_comp).toBe(true)
    expect(input.body_parts).toEqual(bodyParts)
    expect(input.witnesses).toEqual(witnesses)
  })

  it("returns a value (never null) for an empty payload object", () => {
    const input = buildInputFromPayload({})
    expect(input).not.toBeNull()
    expect(input!.injured_person_name).toBe("")
    expect(input!.body_parts).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Field validation
// ---------------------------------------------------------------------------

describe("validateFields", () => {
  const valid: AccidentInput = {
    injured_person_name: "John",
    injured_person_contact: "555",
    injured_person_age: 40,
    description: "hit wall",
    occurred_at: "2026-06-04T08:30",
    location_dropdown_id: null,
    activity_dropdown_id: null,
    severity_dropdown_id: null,
    medical_attention_dropdown_id: null,
    primary_injury_type_dropdown_id: null,
    workers_comp: false,
    workers_comp_ack: false,
    body_parts: [],
    witnesses: [],
  }

  it("returns no errors for a complete, valid input", () => {
    expect(validateFields(valid)).toEqual({})
  })

  it("flags every missing required field", () => {
    const errors = validateFields({
      ...valid,
      injured_person_name: "",
      injured_person_contact: "",
      injured_person_age: null,
      occurred_at: "",
      description: "",
    })
    expect(Object.keys(errors)).toEqual([
      "injured_person_name",
      "injured_person_contact",
      "injured_person_age",
      "occurred_at",
      "description",
    ])
  })

  it("rejects an out-of-range age but accepts the boundaries", () => {
    expect(validateFields({ ...valid, injured_person_age: -1 })).toHaveProperty(
      "injured_person_age",
    )
    expect(validateFields({ ...valid, injured_person_age: 121 })).toHaveProperty(
      "injured_person_age",
    )
    expect(validateFields({ ...valid, injured_person_age: 0 })).toEqual({})
    expect(validateFields({ ...valid, injured_person_age: 120 })).toEqual({})
  })

  it("rejects an unparseable occurred_at", () => {
    expect(
      validateFields({ ...valid, occurred_at: "not-a-date" }),
    ).toHaveProperty("occurred_at")
  })
})

// ---------------------------------------------------------------------------
// Severity mapping
// ---------------------------------------------------------------------------

describe("severityKeyToAlertSeverity", () => {
  it("maps known keys and defaults unknown/null to high", () => {
    expect(severityKeyToAlertSeverity("critical")).toBe("critical")
    expect(severityKeyToAlertSeverity("high")).toBe("high")
    expect(severityKeyToAlertSeverity("medium")).toBe("warn")
    expect(severityKeyToAlertSeverity("low")).toBe("info")
    expect(severityKeyToAlertSeverity(null)).toBe("high")
    expect(severityKeyToAlertSeverity("weird")).toBe("high")
  })
})
