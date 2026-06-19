// Pure ice-depth analytics rollups for the admin Analytics tab. Dependency-free
// (no server-only / Supabase imports) so it can be unit-tested in isolation —
// see analytics.test.ts. The loader in page.tsx fetches the rows and feeds the
// plain shapes below in; everything here is a deterministic reduction.

export type ReadingSeverity = "low" | "ok" | "high"

/** One persisted per-point reading, already snapshotted at submit time. */
export type AnalyticsMeasurement = {
  point_number_snapshot: number
  label_snapshot: string | null
  x_snapshot: number
  y_snapshot: number
  depth_value: number
  severity: ReadingSeverity
}

/** Session-level row (denormalized counters) used for the daily trend. */
export type AnalyticsSession = {
  submitted_at: string
  low_count: number
  high_count: number
  total_measurements: number
}

export type AnalyticsSummary = {
  sessionCount: number
  measurementCount: number
  avgDepth: number
  lowCount: number
  okCount: number
  highCount: number
  /** Fraction of readings classified low / high, in [0,1]. */
  lowRate: number
  highRate: number
}

export type PointRollup = {
  pointNumber: number
  label: string | null
  x: number
  y: number
  count: number
  avg: number
  min: number
  max: number
  lowCount: number
  okCount: number
  highCount: number
  /** Fraction of this point's readings that were low, in [0,1]. */
  lowRate: number
  /** Most frequent severity; ties resolve low > high > ok (worst-first). */
  dominantSeverity: ReadingSeverity
}

export type DayBucket = {
  /** YYYY-MM-DD (UTC). */
  date: string
  sessions: number
  lowCount: number
  highCount: number
  totalMeasurements: number
}

function round(n: number, places = 2): number {
  const f = 10 ** places
  return Math.round(n * f) / f
}

/** Overall rollup across every reading in the window. */
export function summarizeAnalytics(
  measurements: AnalyticsMeasurement[],
  sessionCount: number,
): AnalyticsSummary {
  let sum = 0
  let low = 0
  let ok = 0
  let high = 0
  for (const m of measurements) {
    sum += m.depth_value
    if (m.severity === "low") low += 1
    else if (m.severity === "high") high += 1
    else ok += 1
  }
  const n = measurements.length
  return {
    sessionCount,
    measurementCount: n,
    avgDepth: n > 0 ? round(sum / n) : 0,
    lowCount: low,
    okCount: ok,
    highCount: high,
    lowRate: n > 0 ? round(low / n, 4) : 0,
    highRate: n > 0 ? round(high / n, 4) : 0,
  }
}

function dominantOf(low: number, ok: number, high: number): ReadingSeverity {
  // Worst-first tie-break so a point that is "as often low as ok" surfaces as a
  // problem spot rather than hiding behind ok.
  const max = Math.max(low, ok, high)
  if (low === max) return "low"
  if (high === max) return "high"
  return "ok"
}

/**
 * Per-point rollup keyed by the snapshotted point number, so a point that was
 * later moved or deleted still aggregates across the window. Representative
 * coordinates/label come from the first reading seen for that point. Sorted by
 * point number ascending.
 */
export function rollupByPoint(
  measurements: AnalyticsMeasurement[],
): PointRollup[] {
  type Acc = {
    pointNumber: number
    label: string | null
    x: number
    y: number
    count: number
    sum: number
    min: number
    max: number
    low: number
    ok: number
    high: number
  }
  const byPoint = new Map<number, Acc>()
  for (const m of measurements) {
    let acc = byPoint.get(m.point_number_snapshot)
    if (!acc) {
      acc = {
        pointNumber: m.point_number_snapshot,
        label: m.label_snapshot,
        x: m.x_snapshot,
        y: m.y_snapshot,
        count: 0,
        sum: 0,
        min: m.depth_value,
        max: m.depth_value,
        low: 0,
        ok: 0,
        high: 0,
      }
      byPoint.set(m.point_number_snapshot, acc)
    }
    acc.count += 1
    acc.sum += m.depth_value
    if (m.depth_value < acc.min) acc.min = m.depth_value
    if (m.depth_value > acc.max) acc.max = m.depth_value
    if (m.severity === "low") acc.low += 1
    else if (m.severity === "high") acc.high += 1
    else acc.ok += 1
  }

  return Array.from(byPoint.values())
    .map((a) => ({
      pointNumber: a.pointNumber,
      label: a.label,
      x: a.x,
      y: a.y,
      count: a.count,
      avg: round(a.sum / a.count),
      min: a.min,
      max: a.max,
      lowCount: a.low,
      okCount: a.ok,
      highCount: a.high,
      lowRate: round(a.low / a.count, 4),
      dominantSeverity: dominantOf(a.low, a.ok, a.high),
    }))
    .sort((a, b) => a.pointNumber - b.pointNumber)
}

/**
 * Bucket sessions into UTC days for the trend strip. Returned ascending by
 * date. Uses the session-level denormalized counters (no measurement join).
 */
export function trendByDay(sessions: AnalyticsSession[]): DayBucket[] {
  const byDay = new Map<string, DayBucket>()
  for (const s of sessions) {
    const date = s.submitted_at.slice(0, 10)
    let b = byDay.get(date)
    if (!b) {
      b = { date, sessions: 0, lowCount: 0, highCount: 0, totalMeasurements: 0 }
      byDay.set(date, b)
    }
    b.sessions += 1
    b.lowCount += s.low_count
    b.highCount += s.high_count
    b.totalMeasurements += s.total_measurements
  }
  return Array.from(byDay.values()).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  )
}
