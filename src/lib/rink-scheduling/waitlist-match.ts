// Pure waitlist matching: which open entries does a freed slot satisfy?
// Dependency-free minute/day-key arithmetic, unit-tested; the server side
// (cancellation actions) projects bookings into facility-local terms before
// calling in.
//
// An entry matches a freed slot when, all together:
//   - it wants that facility-local DATE;
//   - it either names no rink, or names the freed slot's rink;
//   - it either gives no time window, or its [start_minute, end_minute)
//     overlaps the freed slot's local window (half-open, like everything
//     else in this module). Entry windows may run past local midnight
//     (end_minute up to 1680); the freed slot's minutes are 0-1440 for the
//     day it was projected onto, so plain interval overlap stays honest.

export type WaitlistEntryLike = {
  id: string
  desired_date: string // YYYY-MM-DD, facility-local
  rink_id: string | null
  start_minute: number | null
  end_minute: number | null
}

export type FreedSlot = {
  /** Facility-local day the freed booking occupied. */
  dayKey: string
  rinkId: string
  /** Facility-local minutes of the freed window on that day. */
  startMinute: number
  endMinute: number
}

export function matchWaitlistEntries(
  entries: WaitlistEntryLike[],
  freed: FreedSlot,
): WaitlistEntryLike[] {
  return entries.filter((e) => {
    if (e.desired_date !== freed.dayKey) return false
    if (e.rink_id !== null && e.rink_id !== freed.rinkId) return false
    if (e.start_minute === null || e.end_minute === null) return true
    return e.start_minute < freed.endMinute && freed.startMinute < e.end_minute
  })
}

/** Distinct entry ids satisfied by ANY of several freed slots (a cancelled
 *  series frees many) — the number the cancellation toast reports. */
export function countMatchedEntries(
  entries: WaitlistEntryLike[],
  freedSlots: FreedSlot[],
): number {
  const matched = new Set<string>()
  for (const slot of freedSlots) {
    for (const e of matchWaitlistEntries(entries, slot)) matched.add(e.id)
  }
  return matched.size
}
