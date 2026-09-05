import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { getFacilityTimezone } from "@/lib/facility-timezone"
import type { Database } from "@/types/database"
import { addDaysToKey, dayKeyInTz } from "@/lib/timezone"

import { monthGridRange } from "./month-model"
import type {
  BookingTypeRow,
  BookingView,
  CalendarView,
  CustomerRow,
  HoursExceptionRow,
  LockerAssignmentView,
  LockerRoomRow,
  OperatingHoursRow,
  RinkRow,
} from "./types"
import { asCalendarView } from "./types"

// The calendar is served from two routes — the read-only dashboard view at
// /reports/rink-scheduling and the full scheduling surface in the admin
// console — so the data assembly lives here, once. Permission resolution
// stays with each page: what a caller may DO with this data is the page's
// (and ultimately the server actions') decision, not the loader's.

export type CalendarSearchParams = {
  view?: string
  date?: string
  rink?: string
  showCancelled?: string
  gaps?: string
}

export type CalendarData = {
  view: CalendarView
  focusKey: string
  todayKey: string
  timeZone: string | null
  rinks: RinkRow[]
  bookingTypes: BookingTypeRow[]
  customers: CustomerRow[]
  bookings: BookingView[]
  hours: OperatingHoursRow[]
  exceptions: HoursExceptionRow[]
  lockerRooms: LockerRoomRow[]
  lockerAssignments: LockerAssignmentView[]
  slotMinutes: number
  bufferMinutes: number
  resurfaceDefaultMinutes: number | null
  selectedRinkId: string | null
  explicitRinkId: string | null
  showCancelled: boolean
  gapsOnly: boolean
}

/** Clock read outside the component body: React's purity rule flags a direct
 *  call during render, and "today" must be resolved in the FACILITY'S zone
 *  anyway, not the server's. */
function nowDate(): Date {
  return new Date()
}

/** Window loaded around the focus date for the day/week/agenda views. Wide
 *  enough that the week view and a fortnight of agenda never need a second
 *  round trip. The month view sizes its own window — see loadWindow(). */
const LOAD_BEFORE_DAYS = 9
const LOAD_AFTER_DAYS = 23

/**
 * Day-key range to query for a view.
 *
 * The month view asks monthGridRange() for exactly the days its grid renders,
 * padding weeks included, so the query and the layout can never disagree about
 * where the month begins. Everything else keeps the fixed window.
 */
function loadWindow(
  view: CalendarView,
  focusKey: string,
): { fromKey: string; toKey: string } {
  if (view === "month") return monthGridRange(focusKey)
  return {
    fromKey: addDaysToKey(focusKey, -LOAD_BEFORE_DAYS),
    toKey: addDaysToKey(focusKey, LOAD_AFTER_DAYS),
  }
}

export async function loadCalendarData(
  supabase: SupabaseClient<Database>,
  facilityId: string,
  params: CalendarSearchParams,
): Promise<CalendarData> {
  const view: CalendarView = asCalendarView(params.view)
  const timeZone = await getFacilityTimezone(supabase, facilityId)

  // "Today" is the rink's today. Deriving it from the server's clock without a
  // zone would put the calendar on the wrong day for several hours each night.
  const todayKey = dayKeyInTz(nowDate(), timeZone)
  const focusKey = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "")
    ? (params.date as string)
    : todayKey

  const { fromKey, toKey } = loadWindow(view, focusKey)

  const [
    rinksRes,
    typesRes,
    customersRes,
    hoursRes,
    exceptionsRes,
    settingsRes,
    lockerRoomsRes,
  ] = await Promise.all([
    supabase
      .from("facility_rinks")
      .select("*")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("rink_booking_types")
      .select("*")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("rink_customers")
      .select("id, name, is_active, default_rate_card_id")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("facility_operating_hours")
      .select("*")
      .eq("facility_id", facilityId),
    supabase
      .from("facility_operating_hours_exceptions")
      .select("*")
      .eq("facility_id", facilityId)
      .gte("exception_date", fromKey)
      .lte("exception_date", toKey),
    supabase
      .from("rink_scheduling_settings")
      .select(
        "slot_increment_minutes, default_buffer_minutes, default_resurface_minutes",
      )
      .eq("facility_id", facilityId)
      .maybeSingle(),
    supabase
      .from("facility_locker_rooms")
      .select("*")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true }),
  ])

  // The window is generous on both sides so a booking that starts before the
  // range but runs into it still renders.
  //
  // The bounds below are UTC instants but fromKey/toKey are facility-LOCAL day
  // keys, so they are slack by one day on each side: 8pm local on the last grid
  // day is already the next date in UTC for any facility west of Greenwich, and
  // would fall outside a tight bound. Each view re-filters to the days it
  // actually renders (the month grid via monthGridRange), so over-fetching a
  // day is free and under-fetching would silently drop edge bookings.
  const queryFromKey = addDaysToKey(fromKey, -1)
  const queryToKey = addDaysToKey(toKey, 1)
  const { data: bookingRows } = await supabase
    .from("rink_bookings")
    .select("*")
    .eq("facility_id", facilityId)
    .gte("starts_at", `${queryFromKey}T00:00:00.000Z`)
    .lte("starts_at", `${queryToKey}T23:59:59.999Z`)
    .order("starts_at", { ascending: true })

  // Assignments are fetched for exactly the bookings on screen, so a wide date
  // range does not pull the whole history of every room.
  const visibleBookingIds = (bookingRows ?? []).map((b) => b.id)
  const { data: lockerAssignmentRows } = visibleBookingIds.length
    ? await supabase
        .from("rink_locker_room_assignments")
        .select(
          "id, booking_id, locker_room_id, occupies_from, occupies_until, display_label_override",
        )
        .eq("facility_id", facilityId)
        .in("booking_id", visibleBookingIds)
        .order("occupies_from", { ascending: true })
    : { data: [] }

  const rinks = rinksRes.data ?? []
  const types = typesRes.data ?? []
  const lockerRooms = (lockerRoomsRes.data ?? []) as LockerRoomRow[]
  const lockerRoomById = new Map(lockerRooms.map((r) => [r.id, r]))
  const lockerAssignments: LockerAssignmentView[] = (
    lockerAssignmentRows ?? []
  ).map((a) => ({
    ...a,
    roomName: lockerRoomById.get(a.locker_room_id)?.name ?? "Locker room",
  }))
  const customers = (customersRes.data ?? []) as CustomerRow[]

  const rinkById = new Map(rinks.map((r) => [r.id, r]))
  const typeById = new Map(types.map((t) => [t.id, t]))
  const customerById = new Map(customers.map((c) => [c.id, c]))

  // Actor names for the booking sheet's audit line — one query for exactly
  // the employees the visible bookings name.
  const actorIds = [
    ...new Set(
      (bookingRows ?? []).flatMap((b) =>
        [b.created_by, b.cancelled_by].filter((id): id is string => id != null),
      ),
    ),
  ]
  const { data: actorRows } = actorIds.length
    ? await supabase
        .from("employees")
        .select("id, first_name, last_name")
        .eq("facility_id", facilityId)
        .in("id", actorIds)
    : { data: [] as { id: string; first_name: string; last_name: string }[] }
  const actorNameById = new Map(
    (actorRows ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`.trim()]),
  )

  const bookings: BookingView[] = (bookingRows ?? []).map((b) => ({
    ...b,
    rinkName: rinkById.get(b.rink_id)?.name ?? "Rink",
    rinkShortCode: rinkById.get(b.rink_id)?.short_code ?? "",
    typeName: typeById.get(b.booking_type_id)?.name ?? "Booking",
    typeColor: typeById.get(b.booking_type_id)?.color ?? "#002244",
    customerName: b.customer_id
      ? (customerById.get(b.customer_id)?.name ?? null)
      : null,
    createdByName: b.created_by ? (actorNameById.get(b.created_by) ?? null) : null,
    cancelledByName: b.cancelled_by
      ? (actorNameById.get(b.cancelled_by) ?? null)
      : null,
  }))

  // An EXPLICIT rink choice is a param that names one of this facility's
  // rinks. Anything else — absent, empty string (`?rink=`), or a stale id
  // from another facility or a deleted rink — normalizes to null here, once,
  // so no downstream consumer has to re-litigate it: the month view reads
  // null as "all rinks", the week view falls back to the first rink, and the
  // create path can never hand the booking sheet an id that isn't real.
  const explicitRinkId = rinks.some((r) => r.id === params.rink)
    ? (params.rink as string)
    : null

  return {
    view,
    focusKey,
    todayKey,
    timeZone,
    rinks,
    bookingTypes: types,
    customers,
    bookings,
    hours: (hoursRes.data ?? []) as OperatingHoursRow[],
    exceptions: (exceptionsRes.data ?? []) as HoursExceptionRow[],
    lockerRooms,
    lockerAssignments,
    slotMinutes: settingsRes.data?.slot_increment_minutes ?? 30,
    bufferMinutes: settingsRes.data?.default_buffer_minutes ?? 15,
    // Passed through raw; resolveResurfaceMinutes() owns the fallback so no
    // component downstream has to know a default number of minutes.
    resurfaceDefaultMinutes: settingsRes.data?.default_resurface_minutes ?? null,
    selectedRinkId: explicitRinkId ?? rinks[0]?.id ?? null,
    explicitRinkId,
    showCancelled: params.showCancelled === "1",
    gapsOnly: params.gaps === "1",
  }
}
