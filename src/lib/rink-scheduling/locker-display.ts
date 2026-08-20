// Pure locker-room occupancy + public TV display logic for Rink Scheduling.
//
// Dependency-free apart from src/lib/timezone.ts (Intl only), so vitest runs it
// in plain Node. Every database read lives in the caller.
//
// THREE JOBS, kept together because they share one notion of "occupancy":
//
//   1. deriveOccupancyWindow — a locker room is held from BEFORE the booking
//      starts (teams arrive to dress) until AFTER it ends (they shower and
//      clear out). The two paddings are the admin-configurable
//      rink_scheduling_settings.locker_lead_minutes / locker_vacate_minutes;
//      nothing here hardcodes 45/30.
//
//   2. findRoomOverlaps — overlapping holds on one room are ALLOWED BY DESIGN
//      (see the comment on rink_locker_room_assignments): fast turnover is
//      normal and a hard constraint would block legitimate back-to-back use.
//      So this returns a WARNING list for the picker, never a rejection.
//
//   3. buildDisplayBoard — the payload behind /display/[token].
//
// ON THE DISPLAY PAYLOAD. The board hangs on a lobby wall that anyone can
// photograph, and its URL is a bearer token that will end up written on a
// sticky note next to the TV. So the shape below is an allow-list, not a
// redaction: it is built field by field from the few things a skater needs
// (room, team label, window, rink) and there is no path by which a customer's
// contact details, a rate, an invoice, or an internal note can reach it.
// `toDisplayBoard` takes already-narrow row types for that reason — widening
// them is the change that would need review.

import { formatInTz } from "@/lib/timezone"

const MINUTE_MS = 60_000

export type OccupancyWindow = {
  occupiesFromIso: string
  occupiesUntilIso: string
}

/**
 * Booking window padded by the facility's lead/vacate minutes.
 *
 * Returns null on unparseable input rather than throwing: the callers are a
 * server action and a picker, and both would rather show "couldn't work that
 * out" than a 500.
 */
export function deriveOccupancyWindow(
  bookingStartsAtIso: string,
  bookingEndsAtIso: string,
  leadMinutes: number,
  vacateMinutes: number,
): OccupancyWindow | null {
  const start = Date.parse(bookingStartsAtIso)
  const end = Date.parse(bookingEndsAtIso)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (end <= start) return null

  const lead = normalizePadding(leadMinutes)
  const vacate = normalizePadding(vacateMinutes)

  return {
    occupiesFromIso: new Date(start - lead * MINUTE_MS).toISOString(),
    occupiesUntilIso: new Date(end + vacate * MINUTE_MS).toISOString(),
  }
}

// Mirrors rink_scheduling_settings_lead_chk / _vacate_chk (0..480). A value
// outside that range means a caller passed something the DB would have
// rejected anyway; clamping keeps the picker usable instead of blank.
function normalizePadding(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0
  return Math.min(480, Math.max(0, Math.round(minutes)))
}

export type AssignmentWindow = {
  id: string
  lockerRoomId: string
  occupiesFrom: string
  occupiesUntil: string
}

/**
 * Existing holds on the same room that overlap `candidate`, half-open `[from,
 * until)` so a hold ending exactly when the next begins is NOT an overlap.
 *
 * Excludes `candidate.id` so editing an existing assignment does not report
 * the row against itself.
 */
export function findRoomOverlaps(
  existing: readonly AssignmentWindow[],
  candidate: AssignmentWindow,
): AssignmentWindow[] {
  const from = Date.parse(candidate.occupiesFrom)
  const until = Date.parse(candidate.occupiesUntil)
  if (!Number.isFinite(from) || !Number.isFinite(until)) return []

  return existing.filter((row) => {
    if (row.id === candidate.id) return false
    if (row.lockerRoomId !== candidate.lockerRoomId) return false
    const rowFrom = Date.parse(row.occupiesFrom)
    const rowUntil = Date.parse(row.occupiesUntil)
    if (!Number.isFinite(rowFrom) || !Number.isFinite(rowUntil)) return false
    return rowFrom < until && from < rowUntil
  })
}

// ---------------------------------------------------------------------------
// Display board
// ---------------------------------------------------------------------------

/** Narrow input row. Deliberately carries no customer, money or notes field. */
export type DisplayAssignmentRow = {
  assignmentId: string
  lockerRoomId: string
  lockerRoomName: string
  lockerRoomShortCode: string
  sortOrder: number
  occupiesFrom: string
  occupiesUntil: string
  /** Team/label to show. Already resolved by the caller from the override or
   *  the booking title — never a customer record. */
  label: string
  /** Rink the booking is on, for "→ Main Rink". Null when unknown. */
  rinkName: string | null
  rinkColor: string | null
}

export type DisplaySlot = {
  assignmentId: string
  label: string
  rinkName: string | null
  rinkColor: string | null
  fromIso: string
  untilIso: string
  /** Facility-local "6:15 PM" strings, formatted server-side so the TV browser
   *  never has to know the facility's zone. */
  fromLabel: string
  untilLabel: string
  state: "occupied" | "upcoming"
  /** Whole minutes until this slot starts. 0 once it is under way. */
  startsInMinutes: number
}

export type DisplayRoom = {
  lockerRoomId: string
  name: string
  shortCode: string
  now: DisplaySlot | null
  next: DisplaySlot[]
}

export type DisplayBoard = {
  generatedAtIso: string
  rooms: DisplayRoom[]
}

export type DisplayRoomRow = {
  id: string
  name: string
  shortCode: string
  sortOrder: number
}

/**
 * Fold assignments into one card per ACTIVE room.
 *
 * Rooms with nothing scheduled are kept and render an empty state — a wall
 * display that hides idle rooms reads as broken, and "Open" is information.
 *
 * `horizonHours` comes from the token's own settings, so two TVs in the same
 * building can show different look-aheads.
 */
export function buildDisplayBoard(
  rooms: readonly DisplayRoomRow[],
  assignments: readonly DisplayAssignmentRow[],
  nowMs: number,
  horizonHours: number,
  timeZone: string | null,
  maxUpcomingPerRoom = 3,
): DisplayBoard {
  const horizonMs = nowMs + clampHorizonHours(horizonHours) * 60 * MINUTE_MS

  const byRoom = new Map<string, DisplaySlot[]>()
  for (const row of assignments) {
    const from = Date.parse(row.occupiesFrom)
    const until = Date.parse(row.occupiesUntil)
    if (!Number.isFinite(from) || !Number.isFinite(until)) continue
    // Already over, or beyond this display's look-ahead.
    if (until <= nowMs) continue
    if (from >= horizonMs) continue

    const occupied = from <= nowMs
    const slot: DisplaySlot = {
      assignmentId: row.assignmentId,
      label: row.label,
      rinkName: row.rinkName,
      rinkColor: row.rinkColor,
      fromIso: row.occupiesFrom,
      untilIso: row.occupiesUntil,
      fromLabel: formatClock(row.occupiesFrom, timeZone),
      untilLabel: formatClock(row.occupiesUntil, timeZone),
      state: occupied ? "occupied" : "upcoming",
      startsInMinutes: occupied ? 0 : Math.max(0, Math.round((from - nowMs) / MINUTE_MS)),
    }
    const list = byRoom.get(row.lockerRoomId)
    if (list) list.push(slot)
    else byRoom.set(row.lockerRoomId, [slot])
  }

  const ordered = [...rooms].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  )

  return {
    generatedAtIso: new Date(nowMs).toISOString(),
    rooms: ordered.map((room) => {
      const slots = (byRoom.get(room.id) ?? []).sort(
        (a, b) => Date.parse(a.fromIso) - Date.parse(b.fromIso),
      )
      // Overlapping holds are legal, so "now" is whichever occupied slot began
      // first and the rest fall through to the upcoming list. The board never
      // silently drops one.
      const nowIndex = slots.findIndex((s) => s.state === "occupied")
      const now = nowIndex >= 0 ? slots[nowIndex] : null
      const next = slots.filter((_, i) => i !== nowIndex).slice(0, maxUpcomingPerRoom)
      return {
        lockerRoomId: room.id,
        name: room.name,
        shortCode: room.shortCode,
        now,
        next,
      }
    }),
  }
}

// Mirrors createDisplayToken's 1..48 validation. A stored setting outside that
// range (hand-edited jsonb) falls back rather than rendering a blank board.
function clampHorizonHours(hours: number): number {
  if (!Number.isFinite(hours)) return 12
  return Math.min(48, Math.max(1, Math.round(hours)))
}

function formatClock(iso: string, timeZone: string | null): string {
  return formatInTz(iso, timeZone, { hour: "numeric", minute: "2-digit" })
}

// ---------------------------------------------------------------------------
// Token shape
// ---------------------------------------------------------------------------

/**
 * Cheap shape check before the database is touched.
 *
 * createDisplayToken issues `randomBytes(32).toString("base64url")` — 43
 * base64url characters, no padding. Rejecting anything else turns a scan of
 * `/display/../../etc/passwd` into a 404 that costs no query, and keeps the
 * rate limiter's budget for plausible guesses.
 */
export function isPlausibleDisplayToken(raw: unknown): raw is string {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{43}$/.test(raw)
}

/**
 * Look-ahead + refresh out of a token's `settings` jsonb.
 *
 * Both are clamped to the ranges the admin form and the CHECK constraints
 * enforce, so a malformed row degrades to a working display instead of a
 * pathological one (a 1-second refresh on a public endpoint is a load
 * problem, and 0 hours ahead is a blank TV).
 */
export function readDisplaySettings(
  settings: unknown,
  fallbackRefreshSeconds: number,
): { hoursAhead: number; refreshSeconds: number } {
  const obj =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {}

  const rawHours = obj.hours_ahead
  const rawRefresh = obj.refresh_seconds

  return {
    hoursAhead: clampHorizonHours(typeof rawHours === "number" ? rawHours : Number.NaN),
    refreshSeconds: clampRefreshSeconds(
      typeof rawRefresh === "number" ? rawRefresh : fallbackRefreshSeconds,
    ),
  }
}

function clampRefreshSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 60
  return Math.min(3600, Math.max(15, Math.round(seconds)))
}
