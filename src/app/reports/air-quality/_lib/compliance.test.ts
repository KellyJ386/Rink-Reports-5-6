import { describe, expect, it } from "vitest"

import {
  alertLevelToSeverity,
  computeFrequencyStatus,
  computeTwa,
  effectiveMetricTiers,
  effectiveTiers,
  evaluateMetric,
  maxAlertLevel,
  parseActiveMetrics,
  parseMethod,
  parseMetrics,
  parseSamplingRules,
  parseTiers,
  validateOverrides,
  type MetricTiers,
  type ProfileTiers,
} from "./compliance"

// MA profile (three-tier + notification) as seeded in migration 146.
const MA_TIERS: ProfileTiers = parseTiers({
  co: {
    corrective: { max: 30 },
    notification: { max: 60, consecutive: { count: 6, over: 30 } },
    evacuation: { max: 125 },
  },
  no2: {
    corrective: { max: 0.5 },
    notification: { max: 1.0, consecutive: { count: 6, over: 0.5 } },
    evacuation: { max: 2.0 },
  },
})

// MN profile (two-tier, evacuation intentionally unset).
const MN_TIERS: ProfileTiers = parseTiers({
  co: { corrective: { max: 20 } },
  no2: { corrective: { max: 0.3 } },
})

describe("parsers", () => {
  it("parses metric definitions, defaulting missing fields", () => {
    const metrics = parseMetrics([
      { key: "co", label: "Carbon Monoxide", unit: "ppm", decimals: 0 },
      { key: "no2" },
      { unit: "ppm" }, // no key → dropped
    ])
    expect(metrics).toHaveLength(2)
    expect(metrics[0]).toEqual({
      key: "co",
      label: "Carbon Monoxide",
      unit: "ppm",
      decimals: 0,
    })
    expect(metrics[1].label).toBe("NO2")
  })

  it("parses tiers and drops empty tier objects", () => {
    expect(MN_TIERS.co.corrective?.max).toBe(20)
    expect(MN_TIERS.co.evacuation).toBeUndefined()
    expect(MA_TIERS.co.notification?.consecutive).toEqual({
      count: 6,
      over: 30,
    })
  })

  it("parses active metrics and method", () => {
    expect(parseActiveMetrics(["co", "no2", 5])).toEqual(["co", "no2"])
    expect(parseMethod("twa_1hr")).toBe("twa_1hr")
    expect(parseMethod("nonsense")).toBe("single")
    expect(parseMethod(null)).toBe("single")
  })

  it("parses sampling rules including the TWA block", () => {
    const rules = parseSamplingRules({
      min_per_week: 2,
      weekend_required: true,
      twa: { samples: 13, interval_min: 5, duration_min: 60 },
    })
    expect(rules.min_per_week).toBe(2)
    expect(rules.weekend_required).toBe(true)
    expect(rules.twa).toEqual({
      samples: 13,
      interval_min: 5,
      duration_min: 60,
    })
  })
})

describe("evaluateMetric", () => {
  it("returns within when at or below the corrective ceiling", () => {
    expect(evaluateMetric(20, MN_TIERS.co)).toBe("within")
    expect(evaluateMetric(0.3, MN_TIERS.no2)).toBe("within")
  })

  it("flags corrective strictly above the ceiling", () => {
    expect(evaluateMetric(21, MN_TIERS.co)).toBe("corrective")
    expect(evaluateMetric(0.31, MN_TIERS.no2)).toBe("corrective")
  })

  it("escalates through MA tiers by single value", () => {
    expect(evaluateMetric(45, MA_TIERS.co)).toBe("corrective")
    expect(evaluateMetric(61, MA_TIERS.co)).toBe("notification")
    expect(evaluateMetric(126, MA_TIERS.co)).toBe("evacuation")
  })

  it("applies the MA consecutive-sample notification rule", () => {
    // 40 ppm is over the corrective ceiling (30) but under the single
    // notification ceiling (60): only the 6th consecutive reading escalates.
    expect(evaluateMetric(40, MA_TIERS.co, { notification: 5 })).toBe(
      "corrective",
    )
    expect(evaluateMetric(40, MA_TIERS.co, { notification: 6 })).toBe(
      "notification",
    )
  })

  it("never reaches evacuation when the tier is unset (MN)", () => {
    expect(evaluateMetric(999, MN_TIERS.co)).toBe("corrective")
  })
})

describe("effective tiers and stricter-only overrides", () => {
  it("tightens a ceiling and ignores loosening", () => {
    const tightened = effectiveMetricTiers(MA_TIERS.co, {
      corrective: { max: 20, consecutive: null },
    })
    expect(tightened.corrective?.max).toBe(20)

    const loosened = effectiveMetricTiers(MA_TIERS.co, {
      corrective: { max: 99, consecutive: null },
    })
    expect(loosened.corrective?.max).toBe(30) // clamped to the floor
  })

  it("adds a ceiling where the profile had none", () => {
    const withEvac = effectiveMetricTiers(MN_TIERS.co, {
      evacuation: { max: 100, consecutive: null },
    })
    expect(withEvac.evacuation?.max).toBe(100)
  })

  it("effectiveTiers maps across every profile metric", () => {
    const eff = effectiveTiers(MA_TIERS, {
      co: { corrective: { max: 25, consecutive: null } },
    })
    expect(eff.co.corrective?.max).toBe(25)
    expect(eff.no2.corrective?.max).toBe(0.5)
  })

  it("validateOverrides rejects loosening but accepts tightening", () => {
    const loosen: ProfileTiers = {
      co: { corrective: { max: 99, consecutive: null } },
    }
    const tighten: ProfileTiers = {
      co: { corrective: { max: 10, consecutive: null } },
    }
    expect(validateOverrides(MA_TIERS, loosen)).toHaveLength(1)
    expect(validateOverrides(MA_TIERS, tighten)).toHaveLength(0)
  })

  it("validateOverrides allows adding a ceiling the profile lacks", () => {
    const addEvac: ProfileTiers = {
      co: { evacuation: { max: 100, consecutive: null } },
    }
    expect(validateOverrides(MN_TIERS, addEvac)).toHaveLength(0)
  })
})

describe("rollups", () => {
  it("maxAlertLevel picks the most severe", () => {
    expect(maxAlertLevel(["within", "corrective", "notification"])).toBe(
      "notification",
    )
    expect(maxAlertLevel(["within"])).toBe("within")
    expect(maxAlertLevel([])).toBe("within")
  })

  it("maps alert levels to the legacy severity enum", () => {
    expect(alertLevelToSeverity("within")).toBeNull()
    expect(alertLevelToSeverity("corrective")).toBe("high")
    expect(alertLevelToSeverity("notification")).toBe("critical")
    expect(alertLevelToSeverity("evacuation")).toBe("critical")
  })
})

describe("computeTwa", () => {
  it("sums readings and divides by the fixed divisor (WI: ÷13)", () => {
    const samples = Array.from({ length: 13 }, () => 13)
    expect(computeTwa(samples, 13)).toBe(13)
  })

  it("divides by the expected count even with gaps, ignoring nulls in the sum", () => {
    // Two readings of 13 → sum 26, divided by the fixed 13 → 2.
    expect(computeTwa([13, null, 13, null], 13)).toBe(2)
  })

  it("returns null with no numeric samples", () => {
    expect(computeTwa([null, null], 13)).toBeNull()
    expect(computeTwa([], 13)).toBeNull()
  })
})

describe("computeFrequencyStatus", () => {
  it("is on schedule when the weekly minimum and splits are met", () => {
    const rules = parseSamplingRules({
      min_per_week: 3,
      min_weekday: 2,
      min_weekend: 1,
    })
    const status = computeFrequencyStatus({
      rules,
      completedWeekday: 2,
      completedWeekend: 1,
    })
    expect(status.requiredTotal).toBe(3)
    expect(status.onSchedule).toBe(true)
    expect(status.behindBy).toBe(0)
  })

  it("flags a weekend shortfall even when the total is met", () => {
    const rules = parseSamplingRules({
      min_per_week: 3,
      min_weekday: 2,
      min_weekend: 1,
    })
    const status = computeFrequencyStatus({
      rules,
      completedWeekday: 3,
      completedWeekend: 0,
    })
    expect(status.completedTotal).toBe(3)
    expect(status.weekendShortfall).toBe(true)
    expect(status.onSchedule).toBe(false)
    expect(status.behindBy).toBe(1)
  })

  it("derives a required weekend sample from weekend_required", () => {
    const rules = parseSamplingRules({ min_per_week: 2, weekend_required: true })
    const status = computeFrequencyStatus({
      rules,
      completedWeekday: 2,
      completedWeekend: 0,
    })
    expect(status.requiredWeekend).toBe(1)
    expect(status.onSchedule).toBe(false)
  })
})

// Type-only sanity: MetricTiers is structurally what the parsers produce.
const _typecheck: MetricTiers = { corrective: { max: 1, consecutive: null } }
void _typecheck
