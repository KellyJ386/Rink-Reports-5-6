// Pure, dependency-free sustained-exceedance engine for Air Quality.
//
// Banded thresholds (warn/alert in air_quality_thresholds) catch single-sample
// exceedances at submit time. Some jurisdictions ALSO require evacuation when a
// pollutant stays above a (lower) level for a sustained duration — e.g. MN:
// CO > 40 ppm for 60 min, or CO > 20 ppm for 120 min. Those rules can't be
// expressed as a single banded threshold, so they live as structured JSON in an
// `air_quality_compliance_rules.rule_body`:
//
//   {"sustained":[{"co":40,"minutes":60},{"co":20,"minutes":120},
//                 {"no2":0.6,"minutes":60},{"no2":0.3,"minutes":120}]}
//
// This module parses those specs and evaluates them against a facility+location
// reading time-series. It is unit-tested; the server-only I/O (loading rules,
// querying the recent series, emitting the alert) lives in submit.ts.
//
// SEMANTICS (documented so the rule author knows what's enforced): a spec is
// "triggered" when the most recent reading is at/above the threshold AND there
// is an unbroken run of at/above-threshold readings spanning at least `minutes`
// (newest reading time minus the oldest contiguous reading time). A single
// reading is never "sustained". A reading below threshold breaks the run.

export type SustainedSpec = {
  /** Pollutant short name as written in the rule (e.g. "co", "no2"). */
  pollutant: string
  /** Threshold in the reading's native unit (ppm). At/above = exceeding. */
  threshold: number
  /** Required sustained duration in minutes (> 0). */
  minutes: number
}

export type SeriesPoint = { atMs: number; value: number }

export type SustainedHit = SustainedSpec & { observedMinutes: number }

const RESERVED_KEYS = new Set(["minutes"])

/** Map a reading-type key ("co_ppm", "no2_ppm") to a spec pollutant ("co", "no2"). */
export function pollutantOfReadingKey(readingKey: string): string {
  return readingKey.toLowerCase().split("_")[0] ?? readingKey.toLowerCase()
}

/**
 * Parse the `{ sustained: [...] }` shape from a compliance rule's `rule_body`
 * (string JSON or already-parsed object). Tolerant: malformed entries are
 * skipped, so a typo can never throw at submit time. Returns one spec per
 * pollutant key found in each entry.
 */
export function parseSustainedSpecs(ruleBody: unknown): SustainedSpec[] {
  let obj: unknown = ruleBody
  if (typeof ruleBody === "string") {
    try {
      obj = JSON.parse(ruleBody)
    } catch {
      return []
    }
  }
  if (!obj || typeof obj !== "object") return []
  const arr = (obj as Record<string, unknown>).sustained
  if (!Array.isArray(arr)) return []

  const specs: SustainedSpec[] = []
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    const minutes =
      typeof e.minutes === "number" ? e.minutes : Number(e.minutes)
    if (!Number.isFinite(minutes) || minutes <= 0) continue
    for (const [k, v] of Object.entries(e)) {
      if (RESERVED_KEYS.has(k)) continue
      const threshold = typeof v === "number" ? v : Number(v)
      if (!Number.isFinite(threshold)) continue
      specs.push({ pollutant: k.toLowerCase(), threshold, minutes })
    }
  }
  return specs
}

/**
 * Evaluate sustained specs against a per-pollutant reading series. Returns the
 * triggered hits (with the observed sustained duration). `seriesByPollutant` is
 * keyed by pollutant short name; each series is the recent readings for that
 * pollutant at one facility+location (any order — sorted here).
 */
export function evaluateSustained(
  specs: readonly SustainedSpec[],
  seriesByPollutant: ReadonlyMap<string, readonly SeriesPoint[]>,
): SustainedHit[] {
  const hits: SustainedHit[] = []
  for (const spec of specs) {
    const series = seriesByPollutant.get(spec.pollutant)
    if (!series || series.length === 0) continue
    const sorted = [...series].sort((a, b) => b.atMs - a.atMs) // newest first
    if (sorted[0].value < spec.threshold) continue
    let oldest = sorted[0]
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].value >= spec.threshold) oldest = sorted[i]
      else break
    }
    const observedMinutes = (sorted[0].atMs - oldest.atMs) / 60_000
    if (observedMinutes >= spec.minutes) {
      hits.push({ ...spec, observedMinutes })
    }
  }
  return hits
}

/** The lookback window (ms) needed to evaluate the given specs. */
export function lookbackMsForSpecs(specs: readonly SustainedSpec[]): number {
  const maxMinutes = specs.reduce((m, s) => Math.max(m, s.minutes), 0)
  return maxMinutes * 60_000
}

/** One-line human summary of a hit, for the alert body. */
export function describeHit(hit: SustainedHit): string {
  const obs = Math.round(hit.observedMinutes)
  return `${hit.pollutant.toUpperCase()} ≥ ${hit.threshold} sustained ${obs} min (limit: ${hit.minutes} min)`
}
