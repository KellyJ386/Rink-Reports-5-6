// Facility-timezone helpers (pure, no TZ libraries — Intl only).
//
// The scheduling model is "facility-local everywhere": staff and admins enter
// wall-clock times in the facility's IANA timezone (facilities.timezone) and
// the database stores real UTC instants. These helpers convert in both
// directions. All functions tolerate a null/invalid timezone by falling back
// to the runtime's local zone, which preserves the previous behavior for
// facilities that never set one.

type DateParts = {
  year: number
  month: number // 1-12
  day: number // 1-31
  hour: number
  minute: number
  second: number
}

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}

function partsInZone(date: Date, timeZone: string): DateParts {
  const parts = partsFormatter(timeZone).formatToParts(date)
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN)
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // Intl formats midnight as "24" with hourCycle h24 quirks in some
    // runtimes; normalize.
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  }
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - (date.getTime() - (date.getTime() % 1000))
}

const WALL_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/

/**
 * Interpret a naked wall-clock string (`YYYY-MM-DDTHH:MM[:SS]`, the
 * datetime-local format) as a time in `timeZone` and return the UTC instant.
 *
 * Strings that already carry an explicit offset/Z are parsed as-is. With a
 * null/unresolvable timezone this falls back to `new Date(wall)` (runtime
 * local), matching the legacy behavior. Returns null for unparseable input.
 *
 * DST notes: times inside a spring-forward gap resolve to the instant the
 * clock would have shown (shifted by the gap); ambiguous fall-back times
 * resolve to one of the two valid instants.
 */
export function wallTimeToUtc(wall: string, timeZone: string | null): Date | null {
  const raw = wall.trim()
  if (!raw) return null

  const m = WALL_RE.exec(raw)
  if (!m) {
    // Explicit offset / Z / other formats: defer to Date parsing.
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  }

  const [, y, mo, d, h, mi, s] = m
  const wallUtcMs = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? "0")
  )
  if (Number.isNaN(wallUtcMs)) return null

  if (!timeZone) {
    const local = new Date(raw)
    return Number.isNaN(local.getTime()) ? null : local
  }

  try {
    // Two-pass convergence: guess the offset at the wall instant, then
    // re-evaluate at the candidate UTC instant (handles DST boundaries).
    let utcMs = wallUtcMs - zoneOffsetMs(new Date(wallUtcMs), timeZone)
    utcMs = wallUtcMs - zoneOffsetMs(new Date(utcMs), timeZone)
    return new Date(utcMs)
  } catch {
    const local = new Date(raw)
    return Number.isNaN(local.getTime()) ? null : local
  }
}

/**
 * Wall-clock string ("YYYY-MM-DDTHH:MM", the datetime-local format) of a UTC
 * instant as seen in `timeZone` — the inverse of wallTimeToUtc, for
 * round-tripping stored instants back into datetime-local inputs. A
 * null/unresolvable timezone falls back to the runtime's local zone (matching
 * wallTimeToUtc's fallback). Returns null for unparseable input.
 */
export function utcToWallTime(
  iso: string | Date,
  timeZone: string | null
): string | null {
  const date = typeof iso === "string" ? new Date(iso) : iso
  if (Number.isNaN(date.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, "0")
  if (timeZone) {
    try {
      const p = partsInZone(date, timeZone)
      return (
        `${p.year}-${pad(p.month)}-${pad(p.day)}` +
        `T${pad(p.hour)}:${pad(p.minute)}`
      )
    } catch {
      // fall through to local
    }
  }
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/**
 * Calendar day key ("YYYY-MM-DD") of a UTC instant as seen in `timeZone`.
 * Null/invalid timezone falls back to the runtime's local zone. Used to
 * bucket shifts onto the correct facility-local day.
 */
export function dayKeyInTz(iso: string | Date, timeZone: string | null): string {
  const date = typeof iso === "string" ? new Date(iso) : iso
  const pad = (n: number) => String(n).padStart(2, "0")
  if (timeZone) {
    try {
      const p = partsInZone(date, timeZone)
      return `${p.year}-${pad(p.month)}-${pad(p.day)}`
    } catch {
      // fall through to local
    }
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Day-of-week (0 = Sunday) and day-of-month of a UTC instant as seen in
 * `timeZone` — for rendering "FRI 12"-style chips on the correct
 * facility-local day.
 */
export function dayPartsInTz(
  iso: string | Date,
  timeZone: string | null
): { dayOfWeek: number; dayOfMonth: number } {
  const key = dayKeyInTz(iso, timeZone)
  const [y, m, d] = key.split("-").map(Number)
  // Construct at UTC noon so the derived weekday can't straddle a boundary.
  const probe = new Date(Date.UTC(y, m - 1, d, 12))
  return { dayOfWeek: probe.getUTCDay(), dayOfMonth: d }
}

/**
 * Minutes since midnight (0–1439) of a UTC instant as seen in `timeZone`. A
 * null/unresolvable timezone falls back to the runtime's local zone. Used to
 * compare a shift's facility-local start/end against operating-hour bounds.
 */
export function minutesOfDayInTz(
  iso: string | Date,
  timeZone: string | null
): number {
  const date = typeof iso === "string" ? new Date(iso) : iso
  if (timeZone) {
    try {
      const p = partsInZone(date, timeZone)
      return p.hour * 60 + p.minute
    } catch {
      // fall through to local
    }
  }
  return date.getHours() * 60 + date.getMinutes()
}

/** Add `n` calendar days to a "YYYY-MM-DD" key (pure calendar math). */
export function addDaysToKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number)
  const probe = new Date(Date.UTC(y, m - 1, d + n, 12))
  const pad = (x: number) => String(x).padStart(2, "0")
  return `${probe.getUTCFullYear()}-${pad(probe.getUTCMonth() + 1)}-${pad(probe.getUTCDate())}`
}

/** Weekday (0 = Sunday) of a "YYYY-MM-DD" key — pure calendar math. */
export function weekdayOfKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number)
  // UTC-noon probe so the derived weekday can't straddle a zone boundary.
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
}

export type WeekWindow = {
  /** "YYYY-MM-DD" of the facility-local week start. */
  startKey: string
  /** The 7 facility-local day keys of the week, in order. */
  dayKeys: string[]
  /** UTC instant of the week start's facility-local midnight (inclusive). */
  startUtc: Date
  /** UTC instant of the NEXT week start's facility-local midnight (exclusive). */
  endUtc: Date
}

/**
 * The facility-local week containing `anchor`, honoring the facility's
 * configured week start (0 = Sunday … 6 = Saturday).
 *
 * This is the ONE definition of "this week" the scheduling module should use
 * for query bounds, KPIs, publish ranges, and day bucketing — it matches how
 * the DB engine computes weekly windows (migration 137: facilities.timezone +
 * schedule_settings.week_start_day). `anchor` may be a UTC instant (bucketed
 * onto the facility-local calendar first) or a "YYYY-MM-DD" key used as-is.
 */
export function weekWindowInTz(
  anchor: Date | string,
  weekStartDay: number,
  timeZone: string | null
): WeekWindow {
  const anchorKey =
    typeof anchor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(anchor)
      ? anchor
      : dayKeyInTz(anchor, timeZone)
  const wsd = ((weekStartDay % 7) + 7) % 7
  const offset = (weekdayOfKey(anchorKey) - wsd + 7) % 7
  const startKey = addDaysToKey(anchorKey, -offset)
  const dayKeys = Array.from({ length: 7 }, (_, i) => addDaysToKey(startKey, i))
  const endKey = addDaysToKey(startKey, 7)
  // Midnights always parse, so the non-null fallbacks are unreachable; they
  // exist to keep the return type non-nullable.
  const startUtc =
    wallTimeToUtc(`${startKey}T00:00:00`, timeZone) ?? new Date(`${startKey}T00:00:00Z`)
  const endUtc =
    wallTimeToUtc(`${endKey}T00:00:00`, timeZone) ?? new Date(`${endKey}T00:00:00Z`)
  return { startKey, dayKeys, startUtc, endUtc }
}
