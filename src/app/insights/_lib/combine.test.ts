import { describe, expect, it } from "vitest"

import {
  aggregateModuleMetrics,
  combineMetricValues,
  computeCoverage,
  daysBetweenInclusive,
  type MetricDefinition,
} from "./combine"

describe("combineMetricValues — scalars", () => {
  it("sums", () => {
    expect(combineMetricValues([1, 2, 3], "sum")).toBe(6)
  })
  it("averages", () => {
    expect(combineMetricValues([2, 4], "avg")).toBe(3)
  })
  it("takes the min", () => {
    expect(combineMetricValues([5, 2, 9], "min")).toBe(2)
  })
  it("takes the max", () => {
    expect(combineMetricValues([5, 2, 9], "max")).toBe(9)
  })
  it("takes the last value for 'last', not the max or sum", () => {
    expect(combineMetricValues([5, 2, 9], "last")).toBe(9)
    expect(combineMetricValues([9, 2, 5], "last")).toBe(5)
  })
  it("skips null/undefined days rather than treating them as zero", () => {
    // A gap day would drag a naive sum/avg down; skipping keeps the figure
    // honest and leaves the gap to computeCoverage to surface separately.
    expect(combineMetricValues([10, null, 20, undefined], "sum")).toBe(30)
    expect(combineMetricValues([10, null, 30], "avg")).toBe(20)
  })
  it("returns null when every day is missing", () => {
    expect(combineMetricValues([null, undefined], "sum")).toBeNull()
    expect(combineMetricValues([], "avg")).toBeNull()
  })
})

describe("combineMetricValues — jsonb object breakdowns", () => {
  it("unions keys and sums per key for a 'sum' breakdown (by_type-style)", () => {
    const days = [{ slip: 2, fall: 1 }, { slip: 1 }, { collision: 3 }]
    expect(combineMetricValues(days, "sum")).toEqual({ slip: 3, fall: 1, collision: 3 })
  })
  it("takes the per-key MAX, not the per-key sum, for a 'max' breakdown (exceedance_max_by_metric-style)", () => {
    const days = [{ co: 15, no2: 5.5 }, { no2: 7.2 }, { co: 12 }]
    expect(combineMetricValues(days, "max")).toEqual({ co: 15, no2: 7.2 })
  })
  it("does NOT merge keys for 'last' — the most recent day's object wins verbatim", () => {
    const days = [{ a: 1, b: 2 }, { a: 99 }]
    // A naive per-key merge would produce {a:99, b:2}; the snapshot contract
    // says day 2 REPLACES day 1 entirely, so b must be absent.
    expect(combineMetricValues(days, "last")).toEqual({ a: 99 })
  })
  it("skips null days when unioning keys", () => {
    const days = [{ a: 1 }, null, { b: 2 }]
    expect(combineMetricValues(days, "sum")).toEqual({ a: 1, b: 2 })
  })
})

describe("combineMetricValues — jsonb array label lists", () => {
  it("unions distinct items regardless of declared mode (out_of_range_fields-style)", () => {
    const days = [["Ice surface temp"], ["Suction pressure", "Ice surface temp"], []]
    const result = combineMetricValues(days, "sum") as string[]
    expect(result.sort()).toEqual(["Ice surface temp", "Suction pressure"])
  })
})

describe("combineMetricValues — mixed/unexpected shapes", () => {
  it("falls back to the last value instead of throwing", () => {
    expect(() => combineMetricValues([1, { a: 2 }], "sum")).not.toThrow()
    expect(combineMetricValues([1, { a: 2 }], "sum")).toEqual({ a: 2 })
  })
})

describe("aggregateModuleMetrics", () => {
  const defs: MetricDefinition[] = [
    { moduleKey: "incident_reports", metricKey: "reported", label: "Reported", unit: null, aggregation: "sum", sortOrder: 1 },
    { moduleKey: "incident_reports", metricKey: "open_at_eod", label: "Open", unit: null, aggregation: "last", sortOrder: 2 },
    { moduleKey: "incident_reports", metricKey: "by_type", label: "By type", unit: null, aggregation: "sum", sortOrder: 3 },
  ]

  it("combines each defined metric across the given rows, sorted by date first", () => {
    const rows = [
      { businessDate: "2026-08-02", moduleKey: "incident_reports", metrics: { reported: 1, open_at_eod: 2, by_type: { slip: 1 } } },
      { businessDate: "2026-08-01", moduleKey: "incident_reports", metrics: { reported: 3, open_at_eod: 1, by_type: { fall: 2 } } },
    ]
    const out = aggregateModuleMetrics({ rows, definitions: defs })
    expect(out.reported).toBe(4)
    // 'last' must resolve chronologically (08-02), not array order.
    expect(out.open_at_eod).toBe(2)
    expect(out.by_type).toEqual({ slip: 1, fall: 2 })
  })

  it("skips a metric key with no registered definition rather than guessing a mode", () => {
    const rows = [{ businessDate: "2026-08-01", moduleKey: "incident_reports", metrics: { reported: 1, rogue_key: 999 } }]
    const out = aggregateModuleMetrics({ rows, definitions: defs })
    expect(out).not.toHaveProperty("rogue_key")
  })

  it("returns null for a metric with zero rows", () => {
    const out = aggregateModuleMetrics({ rows: [], definitions: defs })
    expect(out.reported).toBeNull()
  })
})

describe("daysBetweenInclusive", () => {
  it("counts a single day as 1", () => {
    expect(daysBetweenInclusive("2026-08-01", "2026-08-01")).toBe(1)
  })
  it("counts a whole month correctly", () => {
    expect(daysBetweenInclusive("2026-08-01", "2026-08-31")).toBe(31)
  })
  it("counts across a fiscal-year span (July 1 to next June 30)", () => {
    expect(daysBetweenInclusive("2026-07-01", "2027-06-30")).toBe(365)
  })
})

describe("computeCoverage", () => {
  it("reports full coverage when every requested module has a row for every closed day", () => {
    const datesWithDataByModule = new Map([
      ["incident_reports", new Set(["2026-08-01", "2026-08-02", "2026-08-03"])],
      ["accident_reports", new Set(["2026-08-01", "2026-08-02", "2026-08-03"])],
    ])
    const result = computeCoverage({
      startDate: "2026-08-01",
      endDate: "2026-08-03",
      today: "2026-08-04",
      moduleKeys: ["incident_reports", "accident_reports"],
      datesWithDataByModule,
    })
    expect(result).toEqual({ daysInPeriod: 3, daysWithData: 3, daysMissing: 0 })
  })

  it("flags a day as missing when only SOME of the requested modules have data — never silently complete", () => {
    const datesWithDataByModule = new Map([
      ["incident_reports", new Set(["2026-08-01", "2026-08-02"])],
      // accident_reports never rolled up on 08-02.
      ["accident_reports", new Set(["2026-08-01"])],
    ])
    const result = computeCoverage({
      startDate: "2026-08-01",
      endDate: "2026-08-02",
      today: "2026-08-03",
      moduleKeys: ["incident_reports", "accident_reports"],
      datesWithDataByModule,
    })
    expect(result).toEqual({ daysInPeriod: 2, daysWithData: 1, daysMissing: 1 })
  })

  it("excludes days that have not happened yet (a mid-month 'this month' report is not flagged as broken)", () => {
    const datesWithDataByModule = new Map([
      ["incident_reports", new Set(["2026-08-01", "2026-08-02", "2026-08-03"])],
    ])
    // Viewing August 1-31 on August 4th: only Aug 1-3 are "closed" days a
    // rollup could exist for; 4-31 haven't happened and must not count.
    const result = computeCoverage({
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      today: "2026-08-04",
      moduleKeys: ["incident_reports"],
      datesWithDataByModule,
    })
    expect(result).toEqual({ daysInPeriod: 3, daysWithData: 3, daysMissing: 0 })
  })

  it("returns zero coverage (not a false alarm) when the whole period is still in the future", () => {
    const result = computeCoverage({
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      today: "2026-08-04",
      moduleKeys: ["incident_reports"],
      datesWithDataByModule: new Map(),
    })
    expect(result).toEqual({ daysInPeriod: 0, daysWithData: 0, daysMissing: 0 })
  })

  it("returns zero coverage when no modules are requested", () => {
    const result = computeCoverage({
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      today: "2026-08-10",
      moduleKeys: [],
      datesWithDataByModule: new Map(),
    })
    expect(result).toEqual({ daysInPeriod: 0, daysWithData: 0, daysMissing: 0 })
  })

  it("treats a module with no entry in the map as having zero coverage days, not a crash", () => {
    const datesWithDataByModule = new Map([
      ["incident_reports", new Set(["2026-08-01"])],
    ])
    const result = computeCoverage({
      startDate: "2026-08-01",
      endDate: "2026-08-01",
      today: "2026-08-02",
      moduleKeys: ["incident_reports", "never_rolled_up_module"],
      datesWithDataByModule,
    })
    expect(result).toEqual({ daysInPeriod: 1, daysWithData: 0, daysMissing: 1 })
  })
})
