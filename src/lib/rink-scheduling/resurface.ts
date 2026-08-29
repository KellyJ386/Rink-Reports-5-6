// Pure resurface helpers: duration resolution and the lifecycle rules.
//
// NO HARDCODED MINUTES is the design requirement migration 265 wrote into the
// schema comments; this module is the one place code turns those settings
// into a number, so nothing else is ever tempted to type "15".

export type ResurfaceDurationSource = {
  /** rink_scheduling_settings.default_resurface_minutes. */
  facilityDefaultMinutes: number | null | undefined
  /** facility_rinks.resurface_minutes_override for the chosen sheet. */
  rinkOverrideMinutes: number | null | undefined
}

/**
 * The cut duration for a sheet: per-sheet override, else facility default.
 * Both are CHECK-bounded 1-120 in the DB; out-of-range or missing values
 * (a settings row that predates 265) clamp into range rather than producing
 * a zero-length or day-long cut.
 */
export function resolveResurfaceMinutes(source: ResurfaceDurationSource): number {
  const candidate = source.rinkOverrideMinutes ?? source.facilityDefaultMinutes
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) return 15
  return Math.min(120, Math.max(1, Math.round(candidate)))
}

export type ResurfaceLifecycleStatus = "scheduled" | "completed" | "skipped"

/** The transitions the UI offers. Every state can return to scheduled (the
 *  coherence trigger clears the resolution stamps); scheduled can resolve
 *  either way. Same-state writes are pointless and refused. */
export function canTransition(
  from: ResurfaceLifecycleStatus,
  to: ResurfaceLifecycleStatus,
): boolean {
  return from !== to
}
