// Pure period-aggregation logic for the reporting layer. No server-only
// imports — this is unit-tested directly (see combine.test.ts), matching the
// project convention of splitting testable logic out of server-only modules
// (CLAUDE.md: "keep testable logic in a pure module").
//
// This file is the one place that implements the aggregation contract
// documented in supabase/migrations/00000000000267_daily_metrics_rollup_functions.sql
// ("JSONB-VALUED METRICS" / "ACKNOWLEDGED APPROXIMATIONS"): how a column of
// per-day values in facility_daily_metrics.metrics combines into one
// period-level number, keyed by report_metric_definitions.aggregation.

import { addDaysToKey } from "@/lib/timezone"

export type AggregationMode = "sum" | "avg" | "max" | "min" | "last"

export type MetricDefinition = {
  moduleKey: string
  metricKey: string
  label: string
  unit: string | null
  aggregation: AggregationMode
  sortOrder: number
}

export type DailyMetricRow = {
  /** "YYYY-MM-DD", facility-local (migration 267). */
  businessDate: string
  moduleKey: string
  metrics: Record<string, unknown>
}

type JsonRecord = Record<string, unknown>

function isPlainObject(v: unknown): v is JsonRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v)
}

function combineScalars(values: number[], aggregation: AggregationMode): number | null {
  if (values.length === 0) return null
  switch (aggregation) {
    case "sum":
      return values.reduce((a, b) => a + b, 0)
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length
    case "min":
      return Math.min(...values)
    case "max":
      return Math.max(...values)
    case "last":
      // Unreachable from combineMetricValues (last short-circuits before
      // this), kept exhaustive so a future aggregation mode fails to compile
      // here rather than silently falling through.
      return values[values.length - 1] ?? null
  }
}

/**
 * Combines one metric's per-day values (in businessDate ascending order) into
 * one period value, per the contract in migration 270's header:
 *   - 'last': the most recent non-null value, whatever its shape — a
 *     snapshot to REPLACE, never merged with earlier days.
 *   - object values (a breakdown): union the keys, combine per key using the
 *     SAME aggregation mode (recursively — a breakdown's values are always
 *     scalars in this codebase, so recursion bottoms out in one step).
 *   - array values (a label list): union of distinct items, regardless of
 *     mode — there is no numeric "sum" of a set of labels.
 *   - plain numbers: standard sum/avg/min/max.
 *   - a day whose value is null/undefined/missing is skipped, not treated as
 *     zero — a day with NO rollup row is different from a day that rolled up
 *     to zero, and skipping is what keeps sum/avg from being skewed by gaps
 *     (coverage, computed separately, is what surfaces the gap itself).
 */
export function combineMetricValues(values: unknown[], aggregation: AggregationMode): unknown {
  const present = values.filter((v) => v !== null && v !== undefined)
  if (present.length === 0) return null

  if (aggregation === "last") {
    return present[present.length - 1]
  }

  if (present.every(isFiniteNumber)) {
    return combineScalars(present as number[], aggregation)
  }

  if (present.every(isPlainObject)) {
    const keys = new Set<string>()
    for (const obj of present as JsonRecord[]) {
      for (const k of Object.keys(obj)) keys.add(k)
    }
    const out: JsonRecord = {}
    for (const k of keys) {
      const perKeyValues = (present as JsonRecord[]).map((obj) => obj[k])
      out[k] = combineMetricValues(perKeyValues, aggregation)
    }
    return out
  }

  if (present.every((v) => Array.isArray(v))) {
    const union = new Set<unknown>()
    for (const arr of present as unknown[][]) {
      for (const item of arr) union.add(item)
    }
    return Array.from(union)
  }

  // Mixed/unexpected shapes across days for the same metric key shouldn't
  // happen (a module's compute function always emits one stable shape per
  // key), but a report must never crash on a data hiccup — fall back to the
  // most recent value rather than throwing.
  return present[present.length - 1]
}

/**
 * Aggregates one module's daily rows (already filtered to that module and to
 * the period's date range) into {metricKey: periodValue}, using each
 * definition's aggregation mode. A metric with no definition is skipped
 * (rather than guessed at) — report_metric_definitions is the registry of
 * record, so an unregistered key is a seeding gap to fix, not a value to
 * render with an assumed mode.
 */
export function aggregateModuleMetrics(params: {
  rows: DailyMetricRow[]
  definitions: MetricDefinition[]
}): Record<string, unknown> {
  const rowsSorted = [...params.rows].sort((a, b) => a.businessDate.localeCompare(b.businessDate))
  const out: Record<string, unknown> = {}
  for (const def of params.definitions) {
    const values = rowsSorted.map((r) => r.metrics[def.metricKey])
    out[def.metricKey] = combineMetricValues(values, def.aggregation)
  }
  return out
}

/**
 * Inclusive day count between two "YYYY-MM-DD" dates (UTC-safe: parsed as
 * date-only, never through a Date constructor that would apply a local
 * offset).
 */
export function daysBetweenInclusive(startDate: string, endDate: string): number {
  const start = Date.UTC(...(parseDateKey(startDate)))
  const end = Date.UTC(...(parseDateKey(endDate)))
  return Math.round((end - start) / 86_400_000) + 1
}

function parseDateKey(key: string): [number, number, number] {
  const [y, m, d] = key.split("-").map(Number)
  return [y, m - 1, d]
}

/**
 * Coverage for a period: how many of its days have a completed rollup, so a
 * report can say "19 of 31 days" instead of silently under-counting. Bounded
 * to CLOSED days only (start..min(end, today-1)) — a day that hasn't
 * happened yet was never going to have a rollup, and counting it as
 * "missing" would make every report of the current month or year look
 * broken. A day counts as covered only if EVERY requested module has a row
 * for it — a day where one of several modules never rolled up is not
 * silently presented as complete.
 */
export function computeCoverage(params: {
  startDate: string
  endDate: string
  /** Facility-local "today" ("YYYY-MM-DD"), so the boundary is the caller's zone, not UTC. */
  today: string
  moduleKeys: string[]
  /** For each requested module, the set of "YYYY-MM-DD" dates that have a facility_daily_metrics row. */
  datesWithDataByModule: Map<string, Set<string>>
}): { daysInPeriod: number; daysWithData: number; daysMissing: number } {
  if (params.moduleKeys.length === 0) {
    return { daysInPeriod: 0, daysWithData: 0, daysMissing: 0 }
  }

  const yesterday = addDaysToKey(params.today, -1)
  const closedEnd = params.endDate < yesterday ? params.endDate : yesterday

  if (closedEnd < params.startDate) {
    return { daysInPeriod: 0, daysWithData: 0, daysMissing: 0 }
  }

  const daysInPeriod = daysBetweenInclusive(params.startDate, closedEnd)
  let daysWithData = 0
  let cursor = params.startDate
  for (let i = 0; i < daysInPeriod; i++) {
    const allModulesHaveData = params.moduleKeys.every((mk) =>
      params.datesWithDataByModule.get(mk)?.has(cursor),
    )
    if (allModulesHaveData) daysWithData++
    cursor = addDaysToKey(cursor, 1)
  }

  return { daysInPeriod, daysWithData, daysMissing: daysInPeriod - daysWithData }
}
