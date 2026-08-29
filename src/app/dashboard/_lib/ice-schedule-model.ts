// Pure view-model for the dashboard's read-only Ice Schedule widget.
//
// Dependency-free — no timezone math, no Supabase types. The server-only
// fetch (ice-schedule.ts) has already converted every instant into a
// facility-local startMinute/endMinute (via grid-model.ts's
// bookingMinutesOnDay, the same helper the full calendar uses) before
// anything here sees it; this module only groups and picks.

export type ReadOnlyBooking = {
  id: string
  rinkId: string
  /** Facility-local minutes past midnight, already resolved for "today". */
  startMinute: number
  endMinute: number
  /** Real UTC instant, kept alongside the minute pair so "next upcoming"
   *  can compare against "now" correctly even for a booking that started
   *  yesterday and runs past local midnight. */
  startsAtIso: string
  label: string
  typeColor: string
  tentative: boolean
  isResurface: boolean
  resurfaceStatus: "scheduled" | "completed" | "skipped" | null
}

export type RinkTodaySchedule = {
  id: string
  name: string
  shortCode: string
  color: string
  /** Today's bookings on this sheet, sorted earliest first. */
  bookings: ReadOnlyBooking[]
  /** The next resurface still ahead of "now" today, or null if the sheet has
   *  none scheduled (already cut, skipped, or nothing planned). */
  nextResurface: ReadOnlyBooking | null
}

/**
 * The next unresolved resurface on a sheet: still `scheduled` (not completed
 * or skipped) and not yet started. Only "today, remaining" is considered —
 * this widget never looks past the day it's showing.
 */
export function nextUpcomingResurface(
  bookings: ReadOnlyBooking[],
  nowIso: string,
): ReadOnlyBooking | null {
  const now = new Date(nowIso).getTime()
  let best: ReadOnlyBooking | null = null
  for (const b of bookings) {
    if (!b.isResurface || b.resurfaceStatus !== "scheduled") continue
    if (new Date(b.startsAtIso).getTime() < now) continue
    if (!best || new Date(b.startsAtIso).getTime() < new Date(best.startsAtIso).getTime()) {
      best = b
    }
  }
  return best
}

/** Groups today's bookings by rink and attaches each rink's next resurface.
 *  A rink with no bookings still gets an entry, so the front desk sees every
 *  sheet is empty rather than the sheet silently vanishing. */
export function buildRinkSchedules(
  rinks: Array<{ id: string; name: string; shortCode: string; color: string }>,
  bookings: ReadOnlyBooking[],
  nowIso: string,
): RinkTodaySchedule[] {
  return rinks.map((rink) => {
    const rinkBookings = bookings
      .filter((b) => b.rinkId === rink.id)
      .sort((a, b) => a.startMinute - b.startMinute)
    return {
      id: rink.id,
      name: rink.name,
      shortCode: rink.shortCode,
      color: rink.color,
      bookings: rinkBookings,
      nextResurface: nextUpcomingResurface(rinkBookings, nowIso),
    }
  })
}
