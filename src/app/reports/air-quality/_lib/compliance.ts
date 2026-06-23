// Pure jurisdiction-aware compliance engine for Air Quality. No server-only or
// React imports live here, so it is safe to unit-test in isolation
// (compliance.test.ts) and to import from both the reading form (client) and
// the server submit pipeline.
//
// It parses the global compliance profile + per-facility config (both stored as
// jsonb), resolves the EFFECTIVE tiers (profile floor tightened by facility
// stricter-only overrides), evaluates a metric value (single-sample or 1-hr
// TWA) into an escalating alert level, validates overrides as stricter-only,
// and computes the "are we on schedule?" frequency status.

import type { Json } from "@/types/database"
import type { AirQualitySeverity } from "../types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AlertLevel = "within" | "corrective" | "notification" | "evacuation"

/** Escalating tiers, excluding the neutral "within" baseline. */
export const TIER_LEVELS = ["corrective", "notification", "evacuation"] as const
export type TierLevel = (typeof TIER_LEVELS)[number]

export const ALERT_RANK: Record<AlertLevel, number> = {
  within: 0,
  corrective: 1,
  notification: 2,
  evacuation: 3,
}

export type MeasurementMethod = "single" | "twa_1hr"

export type MetricDef = {
  key: string
  label: string
  unit: string
  decimals: number
}

export type TierBound = {
  /** Single/averaged ceiling — a value strictly greater than max hits the tier. */
  max: number | null
  /** MA-style "N consecutive samples over X" rule. */
  consecutive: { count: number; over: number } | null
}

export type MetricTiers = Partial<Record<TierLevel, TierBound>>
export type ProfileTiers = Record<string, MetricTiers>

export type SamplingRules = {
  min_per_week: number | null
  min_weekday: number | null
  min_weekend: number | null
  weekend_required: boolean
  post_resurfacing_per_week: number | null
  post_edging_per_week: number | null
  post_resurfacing_minutes: number | null
  next_busiest_weekday: boolean
  twa: { samples: number; interval_min: number; duration_min: number } | null
}

// ---------------------------------------------------------------------------
// Lenient JSON readers (never throw; bad input → safe defaults)
// ---------------------------------------------------------------------------

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

export function parseMetrics(json: Json | null | undefined): MetricDef[] {
  if (!Array.isArray(json)) return []
  const out: MetricDef[] = []
  for (const item of json) {
    const o = asObj(item)
    const key = str(o.key)
    if (!key) continue
    out.push({
      key,
      label: str(o.label) ?? key.toUpperCase(),
      unit: str(o.unit) ?? "",
      decimals: num(o.decimals) ?? 0,
    })
  }
  return out
}

function parseTierBound(v: unknown): TierBound | null {
  const o = asObj(v)
  const max = num(o.max)
  const consRaw = asObj(o.consecutive)
  const count = num(consRaw.count)
  const over = num(consRaw.over)
  const consecutive =
    count !== null && over !== null ? { count, over } : null
  if (max === null && consecutive === null) return null
  return { max, consecutive }
}

export function parseTiers(json: Json | null | undefined): ProfileTiers {
  const root = asObj(json)
  const out: ProfileTiers = {}
  for (const [metric, tiersRaw] of Object.entries(root)) {
    const tiers = asObj(tiersRaw)
    const metricTiers: MetricTiers = {}
    for (const level of TIER_LEVELS) {
      const bound = parseTierBound(tiers[level])
      if (bound) metricTiers[level] = bound
    }
    out[metric] = metricTiers
  }
  return out
}

export function parseActiveMetrics(json: Json | null | undefined): string[] {
  if (!Array.isArray(json)) return []
  return json.filter((x): x is string => typeof x === "string")
}

export function parseSamplingRules(
  json: Json | null | undefined,
): SamplingRules {
  const o = asObj(json)
  const twaRaw = asObj(o.twa)
  const samples = num(twaRaw.samples)
  const interval = num(twaRaw.interval_min)
  const duration = num(twaRaw.duration_min)
  return {
    min_per_week: num(o.min_per_week),
    min_weekday: num(o.min_weekday),
    min_weekend: num(o.min_weekend),
    weekend_required: o.weekend_required === true,
    post_resurfacing_per_week: num(o.post_resurfacing_per_week),
    post_edging_per_week: num(o.post_edging_per_week),
    post_resurfacing_minutes: num(o.post_resurfacing_minutes),
    next_busiest_weekday: o.next_busiest_weekday === true,
    twa:
      samples !== null
        ? {
            samples,
            interval_min: interval ?? 5,
            duration_min: duration ?? 60,
          }
        : null,
  }
}

export function parseMethod(v: string | null | undefined): MeasurementMethod {
  return v === "twa_1hr" ? "twa_1hr" : "single"
}

// ---------------------------------------------------------------------------
// Effective tiers (profile floor tightened by stricter-only overrides)
// ---------------------------------------------------------------------------

/**
 * Merge a base metric tier set with facility overrides, keeping the STRICTER
 * (lower) ceiling. An override may add a ceiling where the profile has none
 * (more protective) or lower an existing one, but can never raise it — any
 * loosening override is clamped back to the base. Validate separately with
 * {@link validateOverrides} to surface loosening attempts as errors.
 */
export function effectiveMetricTiers(
  base: MetricTiers,
  override: MetricTiers | undefined,
): MetricTiers {
  if (!override) return base
  const out: MetricTiers = {}
  for (const level of TIER_LEVELS) {
    const b = base[level]
    const o = override[level]
    if (!b && !o) continue
    if (!o) {
      out[level] = b!
      continue
    }
    const baseMax = b?.max ?? null
    const overMax = o.max
    const max =
      overMax === null
        ? baseMax
        : baseMax === null
          ? overMax
          : Math.min(baseMax, overMax)
    out[level] = { max, consecutive: b?.consecutive ?? o.consecutive }
  }
  return out
}

export function effectiveTiers(
  profile: ProfileTiers,
  overrides: ProfileTiers,
): ProfileTiers {
  const out: ProfileTiers = {}
  for (const [metric, base] of Object.entries(profile)) {
    out[metric] = effectiveMetricTiers(base, overrides[metric])
  }
  return out
}

export type OverrideError = {
  metric: string
  level: TierLevel
  message: string
}

/**
 * Reject any override that LOOSENS a regulatory ceiling (override max greater
 * than the profile floor). Tightening (lower) or adding a ceiling is allowed.
 */
export function validateOverrides(
  profile: ProfileTiers,
  overrides: ProfileTiers,
): OverrideError[] {
  const errors: OverrideError[] = []
  for (const [metric, metricOverride] of Object.entries(overrides)) {
    const base = profile[metric] ?? {}
    for (const level of TIER_LEVELS) {
      const o = metricOverride[level]
      const b = base[level]
      if (!o || o.max === null) continue
      if (b && b.max !== null && o.max > b.max) {
        errors.push({
          metric,
          level,
          message: `${metric.toUpperCase()} ${level} override (${o.max}) is looser than the regulatory floor (${b.max}); overrides may only tighten.`,
        })
      }
    }
  }
  return errors
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate one metric value against its effective tiers, returning the highest
 * tier hit. `consecutiveOver` is the count of consecutive samples (including
 * this one) over each tier's `consecutive.over` value — pass {} when unknown.
 */
export function evaluateMetric(
  value: number,
  tiers: MetricTiers,
  consecutiveOver: Partial<Record<TierLevel, number>> = {},
): AlertLevel {
  // High → low so the most severe wins.
  for (let i = TIER_LEVELS.length - 1; i >= 0; i--) {
    const level = TIER_LEVELS[i]
    const t = tiers[level]
    if (!t) continue
    if (t.max !== null && value > t.max) return level
    if (
      t.consecutive &&
      value > t.consecutive.over &&
      (consecutiveOver[level] ?? 0) >= t.consecutive.count
    ) {
      return level
    }
  }
  return "within"
}

export function maxAlertLevel(levels: AlertLevel[]): AlertLevel {
  let top: AlertLevel = "within"
  for (const l of levels) {
    if (ALERT_RANK[l] > ALERT_RANK[top]) top = l
  }
  return top
}

/**
 * Map an engine alert level onto the existing reading severity enum so the
 * legacy readings / communication_alerts pipeline keeps working.
 */
export function alertLevelToSeverity(
  level: AlertLevel,
): AirQualitySeverity | null {
  switch (level) {
    case "evacuation":
    case "notification":
      return "critical"
    case "corrective":
      return "high"
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// 1-hour time-weighted average (WI: 13 readings every 5 min, summed ÷ 13)
// ---------------------------------------------------------------------------

/**
 * Compute the TWA from up to `divisor` samples. Per the WI method the sum of
 * all readings is divided by the fixed expected sample count (13), not by the
 * number actually entered. Returns null when no numeric samples are present.
 */
export function computeTwa(
  samples: Array<number | null>,
  divisor: number,
): number | null {
  const nums = samples.filter(
    (s): s is number => typeof s === "number" && Number.isFinite(s),
  )
  if (nums.length === 0 || divisor <= 0) return null
  const sum = nums.reduce((a, b) => a + b, 0)
  return sum / divisor
}

// ---------------------------------------------------------------------------
// Frequency tracking ("are we on schedule?")
// ---------------------------------------------------------------------------

export type FrequencyInput = {
  rules: SamplingRules
  /** Readings already completed this period, split by day type. */
  completedWeekday: number
  completedWeekend: number
}

export type FrequencyStatus = {
  requiredWeekday: number
  requiredWeekend: number
  requiredTotal: number
  completedWeekday: number
  completedWeekend: number
  completedTotal: number
  onSchedule: boolean
  /** How many more readings are needed to be on schedule (0 when on track). */
  behindBy: number
  weekendShortfall: boolean
}

export function computeFrequencyStatus({
  rules,
  completedWeekday,
  completedWeekend,
}: FrequencyInput): FrequencyStatus {
  const requiredWeekday = Math.max(0, rules.min_weekday ?? 0)
  // A required weekend sample falls out of either an explicit min_weekend or the
  // weekend_required flag.
  const requiredWeekend = Math.max(
    0,
    rules.min_weekend ?? (rules.weekend_required ? 1 : 0),
  )
  // Total is the larger of an explicit weekly minimum or the day-split sum.
  const requiredTotal = Math.max(
    rules.min_per_week ?? 0,
    requiredWeekday + requiredWeekend,
  )
  const completedTotal = completedWeekday + completedWeekend

  const weekdayShort = Math.max(0, requiredWeekday - completedWeekday)
  const weekendShort = Math.max(0, requiredWeekend - completedWeekend)
  const totalShort = Math.max(0, requiredTotal - completedTotal)
  const behindBy = Math.max(totalShort, weekdayShort + weekendShort)

  return {
    requiredWeekday,
    requiredWeekend,
    requiredTotal,
    completedWeekday,
    completedWeekend,
    completedTotal,
    onSchedule: behindBy === 0,
    behindBy,
    weekendShortfall: weekendShort > 0,
  }
}
