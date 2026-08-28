// Pure board assembly for the public ice-schedule TV display.
//
// Same contract as locker-display.ts: everything here is arithmetic over
// already-fetched rows, tested in plain Node, and the emitted shape is the
// COMPLETE public payload — a label, a window, a rink. No customer, no rate,
// no note, no id that addresses anything else. The board hangs where the
// public can photograph it.

export type ScheduleBookingRow = {
  id: string
  rinkId: string
  /** ISO instants. */
  startsAt: string
  endsAt: string
  status: string
  /** Booking title, if the scheduler gave one. */
  title: string | null
  /** Booking type name — the fallback label ("Public Skate", "Practice"). */
  typeName: string | null
}

export type ScheduleRinkRow = {
  id: string
  name: string
  color: string | null
  sortOrder: number
}

export type ScheduleSlot = {
  startsAt: string
  endsAt: string
  label: string
  /** Live right now (start <= now < end). */
  current: boolean
}

export type ScheduleRink = {
  rinkId: string
  name: string
  color: string | null
  slots: ScheduleSlot[]
}

export type ScheduleBoard = {
  rinks: ScheduleRink[]
  /** ISO horizon the board covers, for the footer. */
  windowEndsAt: string
}

/** Public-safe label: the scheduler's title, else the booking type, else a
 *  neutral word. NEVER the customer record. */
export function publicSlotLabel(title: string | null, typeName: string | null): string {
  return (title ?? "").trim() || (typeName ?? "").trim() || "Reserved"
}

/**
 * Build the board: for each active rink, the non-cancelled bookings that
 * overlap [now, now + hoursAhead), sorted by start. Rinks with no upcoming
 * ice still appear — an empty column is information ("free ice"), not noise.
 */
export function buildIceScheduleBoard(
  rinks: ScheduleRinkRow[],
  bookings: ScheduleBookingRow[],
  nowMs: number,
  hoursAhead: number,
): ScheduleBoard {
  const horizonMs = nowMs + hoursAhead * 3_600_000

  const byRink = new Map<string, ScheduleSlot[]>(rinks.map((r) => [r.id, []]))
  for (const b of bookings) {
    if (b.status === "cancelled") continue
    const slots = byRink.get(b.rinkId)
    if (!slots) continue
    const start = Date.parse(b.startsAt)
    const end = Date.parse(b.endsAt)
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    if (end <= nowMs || start >= horizonMs) continue

    slots.push({
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      label: publicSlotLabel(b.title, b.typeName),
      current: start <= nowMs && nowMs < end,
    })
  }

  const ordered = [...rinks].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  )

  return {
    rinks: ordered.map((r) => ({
      rinkId: r.id,
      name: r.name,
      color: r.color,
      slots: (byRink.get(r.id) ?? []).sort(
        (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
      ),
    })),
    windowEndsAt: new Date(horizonMs).toISOString(),
  }
}
