// Pure ice-depth submission helpers: payload/form parsing, per-point severity
// classification, and the measurement-summary rollup. NO server-only imports
// live here, so this module is safe to unit-test in isolation (see
// compute.test.ts) and is re-used by the server-only `submit.ts` (which adds the
// DB + notification I/O).

import type { Severity, SubmittedMeasurement } from "../types"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v)
}

// ---------------------------------------------------------------------------
// Input model + parsing
// ---------------------------------------------------------------------------

/**
 * Normalized, validated-shape ice-depth submission input shared by both the
 * online server action and the offline replay endpoint. `measurements` is
 * deduped by `point_id` (last write wins); the server still re-loads + snapshots
 * the referenced points and recomputes severity.
 */
export type IceDepthInput = {
  layout_id: string
  layout_slug: string
  notes: string | null
  measurements: SubmittedMeasurement[]
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

/**
 * Parse the `measurements_json` array (online: a JSON string; offline: an
 * already-parsed array). Returns null if the payload is malformed so the caller
 * can reject the whole submission rather than silently dropping points.
 */
export function parseMeasurements(raw: unknown): SubmittedMeasurement[] | null {
  let parsed: unknown = raw
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!Array.isArray(parsed)) return null
  const out: SubmittedMeasurement[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") return null
    const obj = entry as Record<string, unknown>
    if (!isUuid(obj.point_id)) return null
    const depth =
      typeof obj.depth_value === "number"
        ? obj.depth_value
        : typeof obj.depth_value === "string"
          ? Number(obj.depth_value)
          : Number.NaN
    // Depth is a physical measurement: finite and never negative. Offline
    // payloads are untrusted, so reject the whole submission rather than
    // silently persisting a bad reading (mirrors the DB CHECK in mig 138).
    if (!Number.isFinite(depth) || depth < 0) return null
    out.push({ point_id: obj.point_id, depth_value: depth })
  }
  return out
}

/**
 * Deduplicate measurements by `point_id`, last write wins. The form should
 * already be 1:1 per point, but offline payloads are untrusted.
 */
export function dedupeMeasurements(
  measurements: SubmittedMeasurement[],
): Map<string, number> {
  const byPoint = new Map<string, number>()
  for (const m of measurements) {
    byPoint.set(m.point_id, m.depth_value)
  }
  return byPoint
}

/** Build a normalized input from a parsed object (online form or offline JSON). */
export function buildInputFromObject(obj: unknown): IceDepthInput | null {
  if (!obj || typeof obj !== "object") return null
  const o = obj as Record<string, unknown>

  const layout_id = str(o.layout_id)
  const layout_slug = str(o.layout_slug)
  if (!isUuid(layout_id)) return null
  if (!layout_slug) return null

  // Offline payloads carry the measurement array under either `measurements`
  // (preferred) or `measurements_json` (mirroring the online form field).
  const measurementsRaw =
    o.measurements !== undefined ? o.measurements : o.measurements_json
  const measurements = parseMeasurements(measurementsRaw)
  if (!measurements) return null

  const notesRaw = str(o.notes)

  return {
    layout_id,
    layout_slug,
    notes: notesRaw.length > 0 ? notesRaw : null,
    measurements,
  }
}

/** Online path: the review form posts FormData with a `measurements_json` string. */
export function buildInputFromForm(formData: FormData): IceDepthInput | null {
  return buildInputFromObject({
    layout_id: formData.get("layout_id"),
    layout_slug: formData.get("layout_slug"),
    notes: formData.get("notes"),
    measurements_json: formData.get("measurements_json"),
  })
}

/** Offline path: the queued payload IS the input object (untrusted JSON). */
export function buildInputFromPayload(raw: unknown): IceDepthInput | null {
  return buildInputFromObject(raw)
}

// ---------------------------------------------------------------------------
// Severity classification + summary rollup
// ---------------------------------------------------------------------------

/**
 * Classify a depth reading against the facility's snapshotted thresholds.
 * `<= low` is low; `> high` is high; everything in between is ok. Pure, so it is
 * unit-tested directly (and re-used by `persistIceDepth`).
 */
export function severityFor(
  value: number,
  low: number,
  high: number,
): Severity {
  if (value <= low) return "low"
  if (value > high) return "high"
  return "ok"
}

export type MeasurementSummary = {
  total_measurements: number
  low_count: number
  high_count: number
  has_low_reading: boolean
  has_high_reading: boolean
}

/**
 * Roll a list of per-point severities into the session counters stored on
 * `ice_depth_sessions`. Pure given its input.
 */
export function summarizeMeasurements(
  severities: Severity[],
): MeasurementSummary {
  let low = 0
  let high = 0
  for (const s of severities) {
    if (s === "low") low += 1
    else if (s === "high") high += 1
  }
  return {
    total_measurements: severities.length,
    low_count: low,
    high_count: high,
    has_low_reading: low > 0,
    has_high_reading: high > 0,
  }
}

/**
 * Whether a best-effort communication alert should fire, given the facility's
 * `alert_on` setting and what severities are present in the session.
 */
export function shouldFireAlert(
  alertOn: string | null | undefined,
  hasLow: boolean,
  hasHigh: boolean,
): boolean {
  return (
    (alertOn === "low" && hasLow) ||
    (alertOn === "high" && hasHigh) ||
    (alertOn === "any" && (hasLow || hasHigh))
  )
}
