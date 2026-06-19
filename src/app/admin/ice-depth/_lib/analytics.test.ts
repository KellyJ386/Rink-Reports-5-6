import { describe, expect, it } from "vitest"

import {
  rollupByPoint,
  summarizeAnalytics,
  trendByDay,
  type AnalyticsMeasurement,
  type AnalyticsSession,
} from "./analytics"

function m(
  pn: number,
  depth: number,
  severity: AnalyticsMeasurement["severity"],
  extra: Partial<AnalyticsMeasurement> = {},
): AnalyticsMeasurement {
  return {
    point_number_snapshot: pn,
    label_snapshot: extra.label_snapshot ?? `P${pn}`,
    x_snapshot: extra.x_snapshot ?? 0.5,
    y_snapshot: extra.y_snapshot ?? 0.5,
    depth_value: depth,
    severity,
  }
}

describe("summarizeAnalytics", () => {
  it("returns zeros for an empty window", () => {
    expect(summarizeAnalytics([], 0)).toEqual({
      sessionCount: 0,
      measurementCount: 0,
      avgDepth: 0,
      lowCount: 0,
      okCount: 0,
      highCount: 0,
      lowRate: 0,
      highRate: 0,
    })
  })

  it("aggregates depth and severity counts/rates", () => {
    const s = summarizeAnalytics(
      [m(1, 1, "low"), m(2, 2, "ok"), m(3, 3, "ok"), m(4, 6, "high")],
      2,
    )
    expect(s.sessionCount).toBe(2)
    expect(s.measurementCount).toBe(4)
    expect(s.avgDepth).toBe(3) // (1+2+3+6)/4
    expect(s.lowCount).toBe(1)
    expect(s.okCount).toBe(2)
    expect(s.highCount).toBe(1)
    expect(s.lowRate).toBe(0.25)
    expect(s.highRate).toBe(0.25)
  })
})

describe("rollupByPoint", () => {
  it("groups by point number with avg/min/max and severity counts", () => {
    const rows = rollupByPoint([
      m(1, 1.0, "low"),
      m(1, 2.0, "ok"),
      m(1, 3.0, "ok"),
      m(2, 5.0, "high"),
    ])
    expect(rows).toHaveLength(2)
    const p1 = rows[0]
    expect(p1.pointNumber).toBe(1)
    expect(p1.count).toBe(3)
    expect(p1.avg).toBe(2) // (1+2+3)/3
    expect(p1.min).toBe(1)
    expect(p1.max).toBe(3)
    expect(p1.lowCount).toBe(1)
    expect(p1.okCount).toBe(2)
    expect(p1.lowRate).toBeCloseTo(0.3333, 3)
    expect(p1.dominantSeverity).toBe("ok")
  })

  it("sorts ascending by point number regardless of input order", () => {
    const rows = rollupByPoint([m(3, 1, "ok"), m(1, 1, "ok"), m(2, 1, "ok")])
    expect(rows.map((r) => r.pointNumber)).toEqual([1, 2, 3])
  })

  it("breaks dominant-severity ties worst-first (low > high > ok)", () => {
    // 1 low, 1 ok -> low wins the tie so problem spots surface.
    const lowTie = rollupByPoint([m(1, 1, "low"), m(1, 2, "ok")])
    expect(lowTie[0].dominantSeverity).toBe("low")
    // 1 high, 1 ok -> high wins over ok.
    const highTie = rollupByPoint([m(1, 5, "high"), m(1, 2, "ok")])
    expect(highTie[0].dominantSeverity).toBe("high")
  })

  it("keeps the first-seen coordinates/label as representative", () => {
    const rows = rollupByPoint([
      m(1, 1, "ok", { x_snapshot: 0.2, y_snapshot: 0.3, label_snapshot: "Blue" }),
      m(1, 1, "ok", { x_snapshot: 0.9, y_snapshot: 0.9, label_snapshot: "Moved" }),
    ])
    expect(rows[0].x).toBe(0.2)
    expect(rows[0].y).toBe(0.3)
    expect(rows[0].label).toBe("Blue")
  })
})

describe("trendByDay", () => {
  it("buckets sessions into UTC days, ascending", () => {
    const sessions: AnalyticsSession[] = [
      { submitted_at: "2026-06-02T08:00:00Z", low_count: 1, high_count: 0, total_measurements: 5 },
      { submitted_at: "2026-06-01T09:00:00Z", low_count: 0, high_count: 2, total_measurements: 6 },
      { submitted_at: "2026-06-02T20:00:00Z", low_count: 3, high_count: 1, total_measurements: 5 },
    ]
    const days = trendByDay(sessions)
    expect(days.map((d) => d.date)).toEqual(["2026-06-01", "2026-06-02"])
    expect(days[1]).toEqual({
      date: "2026-06-02",
      sessions: 2,
      lowCount: 4,
      highCount: 1,
      totalMeasurements: 10,
    })
  })

  it("returns an empty array for no sessions", () => {
    expect(trendByDay([])).toEqual([])
  })
})
