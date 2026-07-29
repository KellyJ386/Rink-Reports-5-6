// Pure helpers for resolving a facility's scheduling operating hours.
//
// Operating hours are admin-configurable and live on `schedule_settings` as
// minutes-since-local-midnight:
//
//   operating_hours_start_minute  (0-1439)   e.g.  360 = 06:00
//   operating_hours_end_minute    (1-1440)   e.g. 1380 = 23:00, 1440 = midnight
//
// They moved there in migration 232. They previously lived in the
// `facilities.settings` jsonb under the shape documented in migration 128:
//
//   { "scheduling": { "operating_hours": { "start": "06:00", "end": "23:00" } } }
//
// which no in-app writer could ever set, because `facilities` is
// super-admin-write-only — so every facility was pinned to the fallback. That
// legacy location is still READ as a fallback (and was backfilled by migration
// 232), so a hand-set value keeps working.
//
// They drive the scheduling grid's visible hour range and the
// "outside operating hours" advisory. They are NEVER hardcoded as the source
// of truth; DEFAULT_OPERATING_HOURS is only the fallback for a facility that
// has not configured them.
//
// This module is intentionally dependency-free (no server-only imports) so it
// can be unit-tested with vitest. See operating-hours.test.ts.

export type OperatingHours = {
  /** 24-hour wall time, "HH:MM". */
  start: string
  /** 24-hour wall time, "HH:MM". May be "24:00", meaning midnight. */
  end: string
}

/** Fallback used only when a facility has no configured operating hours. */
export const DEFAULT_OPERATING_HOURS: OperatingHours = {
  start: "06:00",
  end: "23:00",
}

export const MINUTES_IN_DAY = 1440

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * True for a 24-hour "HH:MM" wall time. "24:00" is accepted as the exclusive
 * end-of-day value: a rink whose ice runs to midnight cannot express that as
 * "23:59", and treating a midnight end as an overnight wrap made every closing
 * shift raise a spurious out-of-hours advisory.
 */
export function isValidHHMM(value: unknown): value is string {
  return typeof value === "string" && (HHMM.test(value) || value === "24:00")
}

/** Minutes since midnight for a valid "HH:MM" string ("24:00" → 1440). */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":")
  return Number(h) * 60 + Number(m)
}

/** Minutes since midnight → "HH:MM" (1440 → "24:00"). */
export function minutesToHhmm(minutes: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_IN_DAY, Math.round(minutes)))
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

/** The minute columns as stored on `schedule_settings`. */
export type OperatingHoursMinutes = {
  operating_hours_start_minute?: number | null
  operating_hours_end_minute?: number | null
}

function validMinute(value: unknown, max: number): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= max
    ? value
    : null
}

/**
 * Read the legacy `facilities.settings` jsonb location. Tolerant of any shape;
 * each bound falls back independently, matching the pre-migration-232
 * behaviour.
 */
function fromFacilitySettings(settings: unknown): OperatingHours {
  const scheduling = (settings as { scheduling?: unknown } | null | undefined)
    ?.scheduling
  const oh = (
    scheduling as { operating_hours?: unknown } | null | undefined
  )?.operating_hours
  const startRaw = (oh as { start?: unknown } | null | undefined)?.start
  const endRaw = (oh as { end?: unknown } | null | undefined)?.end
  return {
    start: isValidHHMM(startRaw) ? startRaw : DEFAULT_OPERATING_HOURS.start,
    end: isValidHHMM(endRaw) ? endRaw : DEFAULT_OPERATING_HOURS.end,
  }
}

/**
 * Resolve a facility's operating hours, preferring the `schedule_settings`
 * columns and falling back to the legacy `facilities.settings` jsonb, then to
 * DEFAULT_OPERATING_HOURS. An inverted or zero-length range from either source
 * falls back wholesale, so the grid always has a sane, non-empty day to render.
 */
export function resolveOperatingHours(
  scheduleSettings?: OperatingHoursMinutes | null,
  facilitySettings?: unknown
): OperatingHours {
  const startMinute = validMinute(
    scheduleSettings?.operating_hours_start_minute,
    MINUTES_IN_DAY - 1
  )
  const endMinute = validMinute(
    scheduleSettings?.operating_hours_end_minute,
    MINUTES_IN_DAY
  )
  if (startMinute != null && endMinute != null && endMinute > startMinute) {
    return {
      start: minutesToHhmm(startMinute),
      end: minutesToHhmm(endMinute),
    }
  }

  const legacy = fromFacilitySettings(facilitySettings)
  if (hhmmToMinutes(legacy.start) < hhmmToMinutes(legacy.end)) {
    return legacy
  }

  return { ...DEFAULT_OPERATING_HOURS }
}

/**
 * Whether a shift falls outside the facility's operating hours.
 *
 * The end is measured on an ABSOLUTE minute axis anchored to the shift's own
 * start day (`endDayOffset` is how many facility-local calendar days later it
 * ends), so an overnight shift reads as "runs N minutes past close" rather
 * than wrapping around to a small number. That is also what lets a shift
 * ending exactly at midnight sit inside a 24:00 close: the previous
 * "endMinute <= startMinute means it wrapped" test flagged every closing
 * shift, and a `close` of "23:59" could not express midnight at all.
 *
 * Advisory only — the caller decides whether to warn, confirm, or hard-block.
 */
export function isOutsideOperatingHours(args: {
  /** Facility-local minutes-of-day at the shift's start. */
  startMinute: number
  /** Facility-local minutes-of-day at the shift's end. */
  endMinute: number
  /** Whole facility-local days from the start day to the end day (0 = same). */
  endDayOffset: number
  hours: OperatingHours
}): boolean {
  const openMinute = hhmmToMinutes(args.hours.start)
  const closeMinute = hhmmToMinutes(args.hours.end)
  const endAbsolute = args.endMinute + args.endDayOffset * MINUTES_IN_DAY
  return args.startMinute < openMinute || endAbsolute > closeMinute
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
