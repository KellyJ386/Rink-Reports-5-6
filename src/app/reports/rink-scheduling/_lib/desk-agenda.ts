// Pure day-agenda + pinned-widget logic for the front-desk view
// (/reports/rink-scheduling/desk).
//
// Deliberately separate from grid-model.ts's block geometry (this view has no
// grid to lay blocks on, just a list) and from calendar-client.tsx's
// AgendaList (that one opens the edit sheet on click; this view is strictly
// read-only). Both this file and AgendaList still share
// bookingMinutesOnDay() for slicing a booking onto a facility-local day, so
// the two views can never disagree about which day a booking belongs to.

import { addDaysToKey } from "@/lib/timezone"

import { bookingMinutesOnDay } from "./grid-model"

export type DeskBookingRow = {
  id: string
  rink_id: string
  booking_type_id: string
  starts_at: string
  ends_at: string
  status: string
  title: string | null
  /** Null on every non-resurface booking; 'scheduled' | 'completed' | 'skipped'
   *  on one whose type has is_resurface (migration 265's coherence trigger
   *  guarantees this pairing — see rink_bookings_resurface_coherence()). */
  resurface_status: string | null
}

export type DeskRinkRow = { id: string; name: string }

export type DeskTypeRow = {
  id: string
  name: string
  color: string
  slug: string
  /** The durable, structural identifier for an ice-resurface booking type
   *  (migration 265) — "App behavior keys on this flag, never on the type's
   *  name" (that migration's own comment). Unlike a slug, an admin renaming
   *  or recoloring the type can't silently break this. */
  is_resurface: boolean
}

/** The 8 facility-local day keys a front-desk caller can be asked about:
 *  today through one week out. */
export function deskDayOptions(todayKey: string): string[] {
  return Array.from({ length: 8 }, (_, i) => addDaysToKey(todayKey, i))
}

export type DeskAgendaRow = {
  bookingId: string
  rinkId: string
  rinkName: string
  startMinute: number
  endMinute: number
  typeId: string
  typeName: string
  typeColor: string
  label: string
  /** True for an ice-resurface booking — rendered visually distinct from an
   *  ordinary booking, and never hidden by the booking-type filter (a caller
   *  filtering to "Public Skate" still needs to know the ice goes down for
   *  resurfacing in between). */
  isResurface: boolean
}

/**
 * One facility-local day's agenda rows, sorted by start time then rink name.
 * Cancelled bookings never appear — a caller asking what's on the ice cares
 * about what's actually happening, not what fell through.
 */
export function buildDeskAgenda(params: {
  bookings: DeskBookingRow[]
  rinkById: Map<string, DeskRinkRow>
  typeById: Map<string, DeskTypeRow>
  dayKey: string
  timeZone: string | null
  /** Restrict to one booking type id; null/undefined shows every type. */
  typeFilterId?: string | null
}): DeskAgendaRow[] {
  const { bookings, rinkById, typeById, dayKey, timeZone, typeFilterId } = params
  const rows: DeskAgendaRow[] = []

  for (const b of bookings) {
    if (b.status === "cancelled") continue

    const type = typeById.get(b.booking_type_id)
    const isResurface = type?.is_resurface === true
    if (typeFilterId && !isResurface && b.booking_type_id !== typeFilterId) continue

    const minutes = bookingMinutesOnDay(b.starts_at, b.ends_at, dayKey, timeZone)
    if (!minutes) continue

    const rink = rinkById.get(b.rink_id)
    rows.push({
      bookingId: b.id,
      rinkId: b.rink_id,
      rinkName: rink?.name ?? "Rink",
      startMinute: minutes.startMinute,
      endMinute: minutes.endMinute,
      typeId: b.booking_type_id,
      typeName: type?.name ?? "Booking",
      typeColor: type?.color ?? "#002244",
      label: b.title?.trim() || type?.name || "Booking",
      isResurface,
    })
  }

  return rows.sort(
    (a, b) => a.startMinute - b.startMinute || a.rinkName.localeCompare(b.rinkName),
  )
}

export type NextResurface = { rinkId: string; startsAt: string; endsAt: string }

/**
 * The earliest upcoming-or-in-progress resurface per active rink, pinned
 * independent of whatever day the agenda is showing. A rink with nothing
 * scheduled maps to null rather than being omitted, so the widget can render
 * "None scheduled" instead of silently dropping a rink.
 *
 * Requires resurface_status = 'scheduled' — a 'completed' or 'skipped' one
 * is not "next" even if its stored time is still technically in the future
 * (e.g. marked done early), because the operational lifecycle, not the
 * clock, is the source of truth once staff have acted on it.
 */
export function nextResurfacePerRink(params: {
  bookings: DeskBookingRow[]
  rinkIds: string[]
  typeById: Map<string, DeskTypeRow>
  nowMs: number
}): Map<string, NextResurface | null> {
  const { bookings, rinkIds, typeById, nowMs } = params
  const result = new Map<string, NextResurface | null>(rinkIds.map((id) => [id, null]))

  for (const b of bookings) {
    if (b.status === "cancelled") continue
    if (!result.has(b.rink_id)) continue
    if (typeById.get(b.booking_type_id)?.is_resurface !== true) continue
    if (b.resurface_status !== "scheduled") continue
    if (new Date(b.ends_at).getTime() <= nowMs) continue

    const current = result.get(b.rink_id) ?? null
    if (!current || new Date(b.starts_at).getTime() < new Date(current.startsAt).getTime()) {
      result.set(b.rink_id, { rinkId: b.rink_id, startsAt: b.starts_at, endsAt: b.ends_at })
    }
  }

  return result
}

export type NextPublicSkate = { rinkId: string; startsAt: string; endsAt: string }

/**
 * The earliest upcoming-or-in-progress Public Skate session, facility-wide.
 * Matched by slug — the same convention request-actions.ts already uses to
 * find "ice-rental" — since, unlike a resurface type, Public Skate has no
 * durable boolean flag protecting it from being renamed.
 */
export function nextPublicSkate(params: {
  bookings: DeskBookingRow[]
  typeById: Map<string, DeskTypeRow>
  nowMs: number
  slug?: string
}): NextPublicSkate | null {
  const { bookings, typeById, nowMs, slug = "public-skate" } = params
  let best: NextPublicSkate | null = null

  for (const b of bookings) {
    if (b.status === "cancelled") continue
    if (typeById.get(b.booking_type_id)?.slug !== slug) continue
    if (new Date(b.ends_at).getTime() <= nowMs) continue

    if (!best || new Date(b.starts_at).getTime() < new Date(best.startsAt).getTime()) {
      best = { rinkId: b.rink_id, startsAt: b.starts_at, endsAt: b.ends_at }
    }
  }

  return best
}
