import { describe, expect, it } from "vitest"

import {
  REGULATORY_CEILINGS,
  validateThreshold,
  type ThresholdInputs,
} from "./thresholds"

const empty: ThresholdInputs = {
  warn_min: null,
  warn_max: null,
  alert_min: null,
  alert_max: null,
  compliance_min: null,
  compliance_max: null,
}

describe("validateThreshold", () => {
  it("requires at least one value", () => {
    expect(validateThreshold(empty)).toMatch(/At least one/)
  })

  it("rejects min greater than max within a band", () => {
    expect(
      validateThreshold({ ...empty, alert_min: 10, alert_max: 5 }),
    ).toMatch(/Alert min must be less than or equal/)
  })

  it("accepts a valid unconstrained threshold", () => {
    expect(
      validateThreshold({ ...empty, warn_max: 20, alert_max: 83 }),
    ).toBeNull()
  })

  describe("regulatory ceiling clamp", () => {
    const co = REGULATORY_CEILINGS.co_ppm

    it("allows tightening below the regulatory alert ceiling", () => {
      expect(
        validateThreshold({ ...empty, alert_max: 50 }, co),
      ).toBeNull()
    })

    it("allows setting exactly the regulatory ceiling", () => {
      expect(
        validateThreshold({ ...empty, alert_max: 83, compliance_max: 20 }, co),
      ).toBeNull()
    })

    it("blocks loosening the alert_max above the regulatory ceiling", () => {
      expect(
        validateThreshold({ ...empty, alert_max: 120 }, co),
      ).toMatch(/regulatory limit of 83/)
    })

    it("blocks loosening the compliance_max above the regulatory ceiling", () => {
      expect(
        validateThreshold({ ...empty, compliance_max: 35 }, co),
      ).toMatch(/regulatory limit of 20/)
    })

    it("clamps NO2 to its stricter decimal ceiling", () => {
      expect(
        validateThreshold(
          { ...empty, alert_max: 3.5 },
          REGULATORY_CEILINGS.no2_ppm,
        ),
      ).toMatch(/regulatory limit of 2/)
      expect(
        validateThreshold(
          { ...empty, alert_max: 1.5 },
          REGULATORY_CEILINGS.no2_ppm,
        ),
      ).toBeNull()
    })

    it("does not clamp when no ceiling applies (e.g. CO2)", () => {
      expect(
        validateThreshold({ ...empty, alert_max: 9000 }, null),
      ).toBeNull()
    })
  })
})
