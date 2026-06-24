import { describe, expect, it } from "vitest"

import {
  buildInputFromFormData,
  buildInputFromPayload,
  formDataFromUnknown,
  parseReadings,
  readingsFromUnknown,
} from "./compute"

// ---------------------------------------------------------------------------
// Readings parsing
// ---------------------------------------------------------------------------

describe("readingsFromUnknown / parseReadings", () => {
  it("returns null for non-arrays (rejecting the submission)", () => {
    expect(readingsFromUnknown({})).toBeNull()
    expect(readingsFromUnknown("x")).toBeNull()
    expect(parseReadings("not json")).toBeNull()
    expect(parseReadings("{}")).toBeNull()
  })

  it("keeps only entries with a string id and a finite numeric value", () => {
    expect(
      readingsFromUnknown([
        { reading_type_id: "a", value: 1.5 },
        { reading_type_id: "b", value: "2" },
        { reading_type_id: "c", value: NaN },
        { reading_type_id: 9, value: 3 },
        { reading_type_id: "d", value: Infinity },
        null,
        "junk",
        { reading_type_id: "e", value: 0 },
      ]),
    ).toEqual([
      { reading_type_id: "a", value: 1.5 },
      { reading_type_id: "e", value: 0 },
    ])
  })

  it("parses a valid JSON string", () => {
    expect(parseReadings('[{"reading_type_id":"a","value":7}]')).toEqual([
      { reading_type_id: "a", value: 7 },
    ])
  })
})

// ---------------------------------------------------------------------------
// Extended monitoring-log sanitizer
// ---------------------------------------------------------------------------

describe("formDataFromUnknown", () => {
  it("returns null only for non-objects", () => {
    expect(formDataFromUnknown(null)).toBeNull()
    expect(formDataFromUnknown("x")).toBeNull()
    expect(formDataFromUnknown({})).not.toBeNull()
  })

  it("drops unknown keys and nulls bad values without throwing", () => {
    const fd = formDataFromUnknown({
      tester_certification: "  Cert-9 ",
      bogus_key: "dropped",
      equipment: { co_monitor: { type: 42, model: "M1" } },
      section1: {
        arena_status: "operating",
        resurfacers: [{ make_model: "Zam", fuel_type: "propane" }],
        other_equipment: [{ name: "Edger", fuel_type: "plutonium" }],
      },
      section4: { staff_trained: "yes", public_signage: true },
    })!

    expect(fd.tester_certification).toBe("Cert-9")
    expect("bogus_key" in fd).toBe(false)
    expect(fd.equipment.co_monitor).toEqual({
      type: null,
      model: "M1",
      calibration_date: null,
    })
    expect(fd.section1.resurfacers).toEqual([
      { make_model: "Zam", fuel_type: "propane" },
    ])
    // Invalid fuel types become null, the row survives.
    expect(fd.section1.other_equipment).toEqual([
      { name: "Edger", fuel_type: null },
    ])
    // Booleans must be literal true.
    expect(fd.section4.staff_trained).toBe(false)
    expect(fd.section4.public_signage).toBe(true)
  })

  it("caps measurement rows at 100 and coerces numeric strings", () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({
      location: "Rink Level",
      co: String(i),
      no2: "bad",
    }))
    const fd = formDataFromUnknown({ section2: { routine: rows } })!
    expect(fd.section2.routine).toHaveLength(100)
    expect(fd.section2.routine[3]).toMatchObject({ co: 3, no2: null })
  })
})

// ---------------------------------------------------------------------------
// Input builders
// ---------------------------------------------------------------------------

describe("buildInputFromFormData / buildInputFromPayload", () => {
  it("requires location_id and parseable readings", () => {
    const fd = new FormData()
    fd.set("readings_json", "[]")
    expect(buildInputFromFormData(fd)).toBeNull()

    fd.set("location_id", "loc-1")
    fd.set("readings_json", "not json")
    expect(buildInputFromFormData(fd)).toBeNull()

    expect(buildInputFromPayload({ readings: [] })).toBeNull()
    expect(buildInputFromPayload({ location_id: "loc-1", readings: "bad" })).toBeNull()
  })

  it("normalizes optional fields (blank → null, trimmed notes)", () => {
    const fd = new FormData()
    fd.set("location_id", "loc-1")
    fd.set("equipment_id", "")
    fd.set("notes", "  hi  ")
    fd.set("readings_json", '[{"reading_type_id":"a","value":1}]')
    const out = buildInputFromFormData(fd)!
    expect(out.equipment_id).toBeNull()
    expect(out.notes).toBe("hi")
    expect(out.form_data).toBeNull()
  })

  it("payload accepts readings/form_data as objects or JSON strings", () => {
    const asObjects = buildInputFromPayload({
      location_id: "loc-1",
      readings: [{ reading_type_id: "a", value: 1 }],
      form_data: { tester_certification: "C" },
    })!
    const asStrings = buildInputFromPayload({
      location_id: "loc-1",
      readings: '[{"reading_type_id":"a","value":1}]',
      form_data: '{"tester_certification":"C"}',
    })!
    expect(asStrings).toEqual(asObjects)
    expect(asObjects.form_data?.tester_certification).toBe("C")
  })

  it("online (form) and offline (payload) parse to the same shape", () => {
    const fd = new FormData()
    fd.set("location_id", "loc-1")
    fd.set("equipment_id", "eq-1")
    fd.set("notes", "n")
    fd.set("readings_json", '[{"reading_type_id":"a","value":1}]')
    expect(
      buildInputFromPayload({
        location_id: "loc-1",
        equipment_id: "eq-1",
        notes: "n",
        readings: '[{"reading_type_id":"a","value":1}]',
      }),
    ).toEqual(buildInputFromFormData(fd))
  })
})
