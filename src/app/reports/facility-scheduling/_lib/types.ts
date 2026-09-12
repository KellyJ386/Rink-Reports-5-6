import type { Tables } from "@/types/database"

export type RinkRow = Tables<"facility_rinks">
export type BookingRow = Tables<"rink_bookings">
export type BookingTypeRow = Tables<"rink_booking_types">
export type CustomerRow = Tables<"rink_customers">
export type OperatingHoursRow = Tables<"facility_operating_hours">
export type HoursExceptionRow = Tables<"facility_operating_hours_exceptions">
export type LockerRoomRow = Tables<"facility_locker_rooms">

/** One room held by one booking, as the booking sheet needs it. */
export type LockerAssignmentView = {
  id: string
  booking_id: string
  locker_room_id: string
  occupies_from: string
  occupies_until: string
  display_label_override: string | null
  roomName: string
}

/** A booking joined with the labels the grid needs, so the client does not
 *  have to hold the whole customer and type tables to render a block. */
export type BookingView = BookingRow & {
  rinkName: string
  rinkShortCode: string
  typeName: string
  typeColor: string
  customerName: string | null
  /** Resolved from created_by / cancelled_by for the booking sheet's audit
   *  line. Null when the actor is unknown (system-created, or the employee
   *  row is gone). */
  createdByName: string | null
  cancelledByName: string | null
}

export type CalendarView = "day" | "week" | "month" | "list"

export const CALENDAR_VIEWS: ReadonlyArray<{ key: CalendarView; label: string }> = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "list", label: "Agenda" },
]

export function asCalendarView(value: string | undefined): CalendarView {
  const allowed = CALENDAR_VIEWS.map((v) => v.key)
  return (allowed as readonly string[]).includes(value ?? "")
    ? (value as CalendarView)
    : "day"
}

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }

export type SimpleResult = { ok: true } | { ok: false; error: string }

/** A conflict the exclusion constraint refused, rendered back to the user with
 *  enough detail to resolve it. */
export type BookingConflict = {
  id: string
  title: string
  startsAt: string
  endsAt: string
  blocksUntil: string
  rinkName: string
  customerName: string | null
}

export type CreateBookingResult =
  | { ok: true; id: string }
  | { ok: false; error: string; conflicts?: BookingConflict[] }
