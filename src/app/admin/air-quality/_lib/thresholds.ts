// Pure, dependency-free threshold validation for Air Quality admin config.
// Extracted from the "use server" actions module so it can be unit-tested
// without pulling in server-only Supabase imports (see CLAUDE.md testing notes).

export type ThresholdInputs = {
  warn_min: number | null
  warn_max: number | null
  alert_min: number | null
  alert_max: number | null
  compliance_min: number | null
  compliance_max: number | null
}

// Hardcoded regulatory ceilings, keyed by reading-type `key`. These are the
// Minnesota statutory ice-rink limits (shared by the NY-style defaults): the
// single-sample evacuation cutoff (`alert_max`) and the "acceptable whenever
// open to the public" ceiling (`compliance_max`). Admins MAY tighten (set a
// lower/stricter value) but MUST NOT loosen past these floors — a facility
// cannot legally raise its alert threshold above the regulatory maximum.
// Reading types without an entry here (e.g. CO2, an advisory building-air
// metric) are unclamped.
export type RegulatoryCeiling = { alert_max?: number; compliance_max?: number }

export const REGULATORY_CEILINGS: Record<string, RegulatoryCeiling> = {
  co_ppm: { alert_max: 83, compliance_max: 20 },
  no2_ppm: { alert_max: 2.0, compliance_max: 0.3 },
}

export function validateThreshold(
  t: ThresholdInputs,
  ceiling?: RegulatoryCeiling | null,
): string | null {
  const all = [
    t.warn_min,
    t.warn_max,
    t.alert_min,
    t.alert_max,
    t.compliance_min,
    t.compliance_max,
  ]
  if (all.every((v) => v === null)) {
    return "At least one threshold value is required."
  }
  const pairs: Array<[number | null, number | null, string]> = [
    [t.warn_min, t.warn_max, "Warn"],
    [t.alert_min, t.alert_max, "Alert"],
    [t.compliance_min, t.compliance_max, "Compliance"],
  ]
  for (const [min, max, label] of pairs) {
    if (min !== null && max !== null && min > max) {
      return `${label} min must be less than or equal to ${label} max.`
    }
  }
  if (ceiling) {
    if (
      ceiling.alert_max != null &&
      t.alert_max != null &&
      t.alert_max > ceiling.alert_max
    ) {
      return `Alert max cannot exceed the regulatory limit of ${ceiling.alert_max}. You may set a stricter (lower) value.`
    }
    if (
      ceiling.compliance_max != null &&
      t.compliance_max != null &&
      t.compliance_max > ceiling.compliance_max
    ) {
      return `Compliance max cannot exceed the regulatory limit of ${ceiling.compliance_max}. You may set a stricter (lower) value.`
    }
  }
  return null
}
