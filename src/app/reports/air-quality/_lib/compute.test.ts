import { describe, expect, it } from "vitest"

import {
  buildAlertLines,
  buildInputFromFormData,
  buildInputFromPayload,
  evaluateReading,
  formDataFromUnknown,
  lookupThreshold,
  maxSeverityOf,
  parseReadings,
  readingsFromUnknown,
  type ExceedanceDetail,
  type ThresholdRow,
} from "./compute"

function threshold(overrides: Partial<ThresholdRow> = {}): ThresholdRow {
  return {
    id: "t1",
    reading_type_id: "rt-co",
    location_id: null,
    alert_min: null,
    alert_max: 25,
    compliance_min: null,
    compliance_max: 20,
    severity: "high",
    ...overrides,
  }
}

function detail(overrides: Partial<ExceedanceDetail> = {}): ExceedanceDetail {
  return {
    label: "CO",
    value: 30,
    unit: "ppm",
    alert_min: null,
    alert_max: 25,
    severity: "high",
    ...overrides,
  }
}

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

// ---------------------------------------------------------------------------
// Threshold / severity engine
// ---------------------------------------------------------------------------

describe("lookupThreshold", () => {
  const facilityWide = threshold({ id: "t-wide", location_id: null })
  const locSpecific = threshold({ id: "t-loc", location_id: "loc-1" })
  const otherType = threshold({ id: "t-other", reading_type_id: "rt-no2" })

  it("prefers the location-specific threshold over the facility-wide one", () => {
    expect(
      lookupThreshold([facilityWide, locSpecific, otherType], "rt-co", "loc-1")
        ?.id,
    ).toBe("t-loc")
  })

  it("falls back to the facility-wide threshold", () => {
    expect(
      lookupThreshold([facilityWide, locSpecific], "rt-co", "loc-2")?.id,
    ).toBe("t-wide")
  })

  it("returns null when no threshold matches the reading type", () => {
    expect(lookupThreshold([otherType], "rt-co", "loc-1")).toBeNull()
  })
})

describe("evaluateReading", () => {
  it("is exceedance only strictly outside the alert bounds", () => {
    const t = threshold({ alert_min: 10, alert_max: 25 })
    expect(evaluateReading(10, t).isExceedance).toBe(false)
    expect(evaluateReading(25, t).isExceedance).toBe(false)
    expect(evaluateReading(9.9, t).isExceedance).toBe(true)
    expect(evaluateReading(25.1, t).isExceedance).toBe(true)
  })

  it("treats null bounds as open", () => {
    const maxOnly = threshold({ alert_min: null, alert_max: 25 })
    expect(evaluateReading(-1000, maxOnly).isExceedance).toBe(false)
    const neither = threshold({ alert_min: null, alert_max: null })
    expect(evaluateReading(1e9, neither)).toEqual({
      isExceedance: false,
      severity: null,
    })
  })

  it("carries the threshold severity, defaulting unknown values to warn", () => {
    expect(evaluateReading(30, threshold({ severity: "critical" })).severity).toBe(
      "critical",
    )
    expect(evaluateReading(30, threshold({ severity: "bogus" })).severity).toBe(
      "warn",
    )
  })
})

describe("maxSeverityOf", () => {
  it("returns null for an empty list", () => {
    expect(maxSeverityOf([])).toBeNull()
  })

  it("returns the highest-ranked severity regardless of order", () => {
    expect(maxSeverityOf(["warn", "critical", "high"])).toBe("critical")
    expect(maxSeverityOf(["high", "warn"])).toBe("high")
    expect(maxSeverityOf(["warn"])).toBe("warn")
  })
})

describe("buildAlertLines", () => {
  it("annotates the crossed bound with units", () => {
    expect(buildAlertLines([detail()])).toEqual([
      "CO: 30 ppm (alert max 25 ppm)",
    ])
    expect(
      buildAlertLines([
        detail({ value: 2, alert_min: 5, alert_max: null }),
      ]),
    ).toEqual(["CO: 2 ppm (alert min 5 ppm)"])
  })

  it("omits the bound annotation when neither bound matches", () => {
    // Possible when severity came from a min-hit but the value sits between
    // the label thresholds; the line still renders cleanly.
    expect(
      buildAlertLines([detail({ value: 22, alert_min: null, alert_max: 25 })]),
    ).toEqual(["CO: 22 ppm"])
  })

  it("handles a unitless reading without stray spaces", () => {
    expect(
      buildAlertLines([detail({ unit: "", value: 30 })]),
    ).toEqual(["CO: 30 (alert max 25)"])
  })

  it("caps at 5 lines and appends the remainder trailer", () => {
    const details = Array.from({ length: 7 }, (_, i) =>
      detail({ label: `R${i}` }),
    )
    const lines = buildAlertLines(details)
    expect(lines).toHaveLength(6)
    expect(lines[5]).toBe("…and 2 more")
  })
})
