// Pure, dependency-free validation + normalisation for Rink Scheduling admin
// config. Kept free of `server-only` imports so vitest can exercise it in a
// plain Node environment (see CLAUDE.md on the test runner's scope).
//
// Every rule here mirrors a CHECK constraint in migration 247. The point of
// duplicating them is to turn a raw 23514 into a sentence an admin can act on;
// the database remains the authority.

/** Hard cap on ACTIVE rinks per facility. Enforced in the server action, not
 *  the database: deactivating back below the cap must always stay possible,
 *  which a table constraint would make awkward. */
export const MAX_ACTIVE_RINKS = 10

export const SLOT_INCREMENT_CHOICES = [5, 10, 15, 20, 30, 60] as const
export type SlotIncrement = (typeof SLOT_INCREMENT_CHOICES)[number]

/** 0 = Sunday, matching facility_operating_hours.day_of_week and
 *  schedule_settings.week_start_day. */
export const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
}

/** Short codes ride on the TV display and dense grid headers, so they are
 *  upper-cased and length-capped to keep columns aligned. */
export function normalizeShortCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8)
}

export function isHexColor(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(value)
}

/** "HH:MM" or "HH:MM:SS" in facility-local wall clock -> minutes past midnight.
 *  Returns null when unparseable, so callers can report rather than guess. */
export function parseTimeToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

export function minutesToTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440
  const h = Math.floor(m / 60)
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

export type HoursInput = {
  dayOfWeek: number
  isClosed: boolean
  openTime: string
  closeTime: string
}

/** A day may legitimately run past midnight (a 6am-2am rink), which reads as
 *  open > close. That is allowed and interpreted as wrapping into the next
 *  calendar day. Only equal times are rejected — a zero-length open day is
 *  always a typo for "closed". */
export function validateHoursRow(row: HoursInput): string | null {
  if (row.dayOfWeek < 0 || row.dayOfWeek > 6) return "Day of week must be 0-6."
  if (row.isClosed) return null

  const open = parseTimeToMinutes(row.openTime)
  const close = parseTimeToMinutes(row.closeTime)
  if (open === null) return "Opening time must look like 09:00."
  if (close === null) return "Closing time must look like 23:00."
  if (open === close) {
    return "Opening and closing time are the same. Mark the day closed instead."
  }
  return null
}

/** True when the window wraps past midnight into the next day. */
export function wrapsMidnight(openMinutes: number, closeMinutes: number): boolean {
  return closeMinutes < openMinutes
}

export type SettingsInput = {
  defaultBufferMinutes: number
  slotIncrementMinutes: number
  defaultPaymentTermsDays: number
  invoicePrefix: string
  taxRatePercent: string
  lockerLeadMinutes: number
  lockerVacateMinutes: number
  displayRefreshSeconds: number
}

/**
 * Mirrors every CHECK on rink_scheduling_settings so the admin sees a sentence
 * instead of a constraint name. Returns field-keyed messages; empty = valid.
 */
export function validateSettings(input: SettingsInput): Record<string, string> {
  const errors: Record<string, string> = {}

  if (!Number.isInteger(input.defaultBufferMinutes) || input.defaultBufferMinutes < 0 || input.defaultBufferMinutes > 120) {
    errors.defaultBufferMinutes = "Resurfacing buffer must be between 0 and 120 minutes."
  }
  if (!SLOT_INCREMENT_CHOICES.includes(input.slotIncrementMinutes as SlotIncrement)) {
    errors.slotIncrementMinutes = `Calendar slot must be one of ${SLOT_INCREMENT_CHOICES.join(", ")} minutes.`
  }
  if (!Number.isInteger(input.defaultPaymentTermsDays) || input.defaultPaymentTermsDays < 0 || input.defaultPaymentTermsDays > 365) {
    errors.defaultPaymentTermsDays = "Payment terms must be between 0 and 365 days."
  }
  if (!/^[A-Za-z0-9-]{0,12}$/.test(input.invoicePrefix)) {
    errors.invoicePrefix = "Invoice prefix can use letters, numbers and hyphens, up to 12 characters."
  }
  if (!Number.isInteger(input.lockerLeadMinutes) || input.lockerLeadMinutes < 0 || input.lockerLeadMinutes > 480) {
    errors.lockerLeadMinutes = "Locker room lead time must be between 0 and 480 minutes."
  }
  if (!Number.isInteger(input.lockerVacateMinutes) || input.lockerVacateMinutes < 0 || input.lockerVacateMinutes > 480) {
    errors.lockerVacateMinutes = "Locker room vacate time must be between 0 and 480 minutes."
  }
  if (!Number.isInteger(input.displayRefreshSeconds) || input.displayRefreshSeconds < 15 || input.displayRefreshSeconds > 3600) {
    errors.displayRefreshSeconds = "Display refresh must be between 15 and 3600 seconds."
  }

  const taxError = parseTaxRatePercent(input.taxRatePercent).error
  if (taxError) errors.taxRatePercent = taxError

  return errors
}

/**
 * Admins type a PERCENT ("8.75"); the column stores a FRACTION (0.0875).
 * Blank means "no tax line on invoices", which is a real choice and distinct
 * from zero, so it maps to null rather than 0.
 */
export function parseTaxRatePercent(raw: string): { value: number | null; error?: string } {
  const trimmed = raw.trim()
  if (trimmed === "") return { value: null }

  const pct = Number(trimmed)
  if (!Number.isFinite(pct)) return { value: null, error: "Tax rate must be a number, or blank for no tax." }
  if (pct < 0 || pct > 100) return { value: null, error: "Tax rate must be between 0 and 100 percent." }

  // 4 decimal places is what numeric(6,4) holds once converted to a fraction.
  return { value: Number((pct / 100).toFixed(4)) }
}

export function formatTaxRateAsPercent(fraction: number | null): string {
  if (fraction === null || fraction === undefined) return ""
  return String(Number((fraction * 100).toFixed(2)))
}

/** Occupancy defaults for a locker room assignment, from module settings.
 *  Returned as epoch ms so the caller decides how to serialise. */
export function defaultOccupancyWindow(
  bookingStartsAtMs: number,
  bookingEndsAtMs: number,
  leadMinutes: number,
  vacateMinutes: number,
): { fromMs: number; untilMs: number } {
  return {
    fromMs: bookingStartsAtMs - leadMinutes * 60_000,
    untilMs: bookingEndsAtMs + vacateMinutes * 60_000,
  }
}

/** Two occupancy windows overlap when each starts before the other ends.
 *  Half-open, matching the '[)' convention used by the booking constraint, so
 *  a room handed over exactly on the hour is NOT an overlap. */
export function windowsOverlap(
  aFromMs: number,
  aUntilMs: number,
  bFromMs: number,
  bUntilMs: number,
): boolean {
  return aFromMs < bUntilMs && bFromMs < aUntilMs
}

/**
 * Human summary of when a lobby display last checked in.
 *
 * Takes `nowMs` rather than reading the clock itself, for two reasons: it stays
 * pure (so it is unit-testable and safe under React's purity rule, which
 * forbids calling Date.now() during a client render), and it must be evaluated
 * on the SERVER — computing it in the browser would disagree with the
 * server-rendered markup whenever the two clocks differ, producing a hydration
 * mismatch on every display row.
 *
 * A display that has gone dark is the thing an admin actually wants to spot,
 * so "never checked in" is spelled out rather than shown as a blank.
 */
export function describeLastSeen(
  lastSeenIso: string | null,
  nowMs: number,
  revoked: boolean,
): string {
  if (revoked) return "revoked"
  if (!lastSeenIso) return "never checked in"

  const then = new Date(lastSeenIso).getTime()
  if (!Number.isFinite(then)) return "never checked in"

  const mins = Math.round((nowMs - then) / 60_000)
  if (mins < 2) return "active now"
  if (mins < 60) return `last seen ${mins}m ago`

  const hours = Math.round(mins / 60)
  if (hours < 48) return `last seen ${hours}h ago`
  return `last seen ${Math.round(hours / 24)}d ago`
}
