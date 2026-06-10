// Pure helpers for resolving a facility's scheduling operating hours.
//
// Operating hours are admin-configurable and live in `facilities.settings`
// (jsonb) under the documented shape:
//
//   { "scheduling": { "operating_hours": { "start": "06:00", "end": "23:00" } } }
//
// They drive the scheduling grid's visible min/max (react-big-calendar). They
// are NEVER hardcoded as the source of truth; DEFAULT_OPERATING_HOURS is only a
// fallback for when a facility has not configured them yet.
//
// This module is intentionally dependency-free (no server-only imports) so it
// can be unit-tested with vitest. See operating-hours.test.ts.

export type OperatingHours = {
  /** 24-hour wall time, "HH:MM". */
  start: string
  /** 24-hour wall time, "HH:MM". */
  end: string
}

/** Fallback used only when a facility has no configured operating hours. */
export const DEFAULT_OPERATING_HOURS: OperatingHours = {
  start: "06:00",
  end: "23:00",
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isValidHHMM(value: unknown): value is string {
  return typeof value === "string" && HHMM.test(value)
}

/** Minutes since midnight for a valid "HH:MM" string. */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":")
  return Number(h) * 60 + Number(m)
}

/**
 * Read operating hours out of a facility's `settings` jsonb, falling back to
 * DEFAULT_OPERATING_HOURS when missing, malformed, or an inverted/empty range.
 * Tolerant of any unknown shape (settings is loosely typed jsonb).
 */
export function resolveOperatingHours(settings: unknown): OperatingHours {
  const scheduling = (settings as { scheduling?: unknown } | null | undefined)
    ?.scheduling
  const oh = (
    scheduling as { operating_hours?: unknown } | null | undefined
  )?.operating_hours
  const startRaw = (oh as { start?: unknown } | null | undefined)?.start
  const endRaw = (oh as { end?: unknown } | null | undefined)?.end

  const start = isValidHHMM(startRaw) ? startRaw : DEFAULT_OPERATING_HOURS.start
  const end = isValidHHMM(endRaw) ? endRaw : DEFAULT_OPERATING_HOURS.end

  // Guard against an inverted or zero-length window — fall back wholesale so the
  // grid always has a sane, non-empty day to render.
  if (hhmmToMinutes(start) >= hhmmToMinutes(end)) {
    return { ...DEFAULT_OPERATING_HOURS }
  }
  return { start, end }
}

/**
 * Build a Date positioned on `base`'s calendar day at the given "HH:MM" local
 * wall time. react-big-calendar's `min`/`max` only read the time-of-day portion.
 */
export function timeOnDay(base: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":")
  const d = new Date(base)
  d.setHours(Number(h), Number(m), 0, 0)
  return d
}
