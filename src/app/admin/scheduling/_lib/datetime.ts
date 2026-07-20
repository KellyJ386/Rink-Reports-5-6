// Date/time helpers shared by scheduling admin views.
// All week math is done in UTC; the UI displays times in the browser's
// local zone via Intl.DateTimeFormat.

const DAY_MS = 24 * 60 * 60 * 1000

export function parseISODate(s: string | undefined | null): Date | null {
  if (!s) return null
  // Accept YYYY-MM-DD or full ISO.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

export function toISODate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS)
}

/**
 * Returns the start of the week (UTC midnight) for the given date, where
 * weekStartDay uses 0=Sunday..6=Saturday.
 */
export function weekStartFor(date: Date, weekStartDay: number): Date {
  const d0 = startOfUtcDay(date)
  const dow = d0.getUTCDay() // 0=Sun..6=Sat
  const wsd = ((weekStartDay % 7) + 7) % 7
  const offset = (dow - wsd + 7) % 7
  return addDays(d0, -offset)
}

export function weekEndExclusive(weekStart: Date): Date {
  return addDays(weekStart, 7)
}

/**
 * Format a [start, end] timestamptz pair as a short range like "9:00–17:00".
 * Pass the facility `timeZone` from SERVER components (otherwise they render
 * in the server's zone); client components may omit it to use the browser's
 * zone, matching the interactive board.
 */
export function formatTimeRange(
  starts_at: string,
  ends_at: string,
  timeZone?: string | null
): string {
  const s = new Date(starts_at)
  const e = new Date(ends_at)
  const fmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timeZone ?? undefined,
  })
  return `${fmt.format(s)}–${fmt.format(e)}`
}

export function formatDateLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(d)
}

/** "Tue, Aug 4" label for a "YYYY-MM-DD" day key (no zone conversion — the
 * key is already the calendar date to show; the UTC-noon probe just avoids
 * boundary straddle). */
export function formatDayKeyLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number)
  return formatDateLabel(new Date(Date.UTC(y, m - 1, d, 12)))
}

export function formatDateTime(s: string, timeZone?: string | null): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timeZone ?? undefined,
  }).format(new Date(s))
}

export function formatDateOnly(s: string, timeZone?: string | null): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: timeZone ?? undefined,
  }).format(new Date(s))
}

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

export function durationHours(starts_at: string, ends_at: string): number {
  const ms = new Date(ends_at).getTime() - new Date(starts_at).getTime()
  return Math.max(0, ms / (60 * 60 * 1000))
}
