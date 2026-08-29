import Link from "next/link"

import { PageHeader } from "@/components/ui/page-header"
import { requireUser } from "@/lib/auth"
import { getFacilityTimezone } from "@/lib/facility-timezone"
import { currentUserCan } from "@/lib/permissions/check"
import { createClient } from "@/lib/supabase/server"
import { addDaysToKey, dayKeyInTz } from "@/lib/timezone"

import { CalendarClient } from "./_components/calendar-client"
import { NotAvailable } from "./_components/not-available"
import { monthGridRange } from "./_lib/month-model"
import type {
  BookingView,
  CalendarView,
  CustomerRow,
  HoursExceptionRow,
  LockerAssignmentView,
  LockerRoomRow,
  OperatingHoursRow,
} from "./_lib/types"
import { asCalendarView } from "./_lib/types"

export const dynamic = "force-dynamic"

export const metadata = { title: "Rink Schedule | MFO / Rink Reports" }

type SearchParams = Promise<{
  view?: string
  date?: string
  rink?: string
  showCancelled?: string
  gaps?: string
}>

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
function loadWindow(view: CalendarView, focusKey: string): { fromKey: string; toKey: string } {
  if (view === "month") return monthGridRange(focusKey)
  return {
    fromKey: addDaysToKey(focusKey, -LOAD_BEFORE_DAYS),
    toKey: addDaysToKey(focusKey, LOAD_AFTER_DAYS),
  }
}

export default async function RinkSchedulePage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireUser()
  const supabase = await createClient()

  if (!(await currentUserCan(supabase, "rink_scheduling", "view"))) {
    return <NotAvailable />
  }

  // requireUser() already resolves the caller's OWN profile row scoped by id
  // (see getCurrentUser()). The equivalent unscoped `.from("users").select(...)
  // .maybeSingle()` this replaced broke for every is_super_admin account: the
  // users_select RLS policy grants a super admin every row in the table, so
  // with no `.eq("id", ...)` filter the query matched all of them,
  // `.maybeSingle()` errored on the multi-row result, and the discarded
  // `error` left `data` (and so `facilityId`) null — rendering this exact
  // "not attached to a facility" screen for an account that had a perfectly
  // valid facility_id all along.
  const facilityId = current.profile?.facility_id ?? null
  if (!facilityId) return <NotAvailable reason="no-facility" />

  const params = await searchParams
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
    canCreate,
    canEdit,
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
      .select("slot_increment_minutes, default_buffer_minutes")
      .eq("facility_id", facilityId)
      .maybeSingle(),
    supabase
      .from("facility_locker_rooms")
      .select("*")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true }),
    currentUserCan(supabase, "rink_scheduling", "submit"),
    currentUserCan(supabase, "rink_scheduling", "edit"),
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
  const lockerAssignments: LockerAssignmentView[] = (lockerAssignmentRows ?? []).map((a) => ({
    ...a,
    roomName: lockerRoomById.get(a.locker_room_id)?.name ?? "Locker room",
  }))
  const customers = (customersRes.data ?? []) as CustomerRow[]

  const rinkById = new Map(rinks.map((r) => [r.id, r]))
  const typeById = new Map(types.map((t) => [t.id, t]))
  const customerById = new Map(customers.map((c) => [c.id, c]))

  const bookings: BookingView[] = (bookingRows ?? []).map((b) => ({
    ...b,
    rinkName: rinkById.get(b.rink_id)?.name ?? "Rink",
    rinkShortCode: rinkById.get(b.rink_id)?.short_code ?? "",
    typeName: typeById.get(b.booking_type_id)?.name ?? "Booking",
    typeColor: typeById.get(b.booking_type_id)?.color ?? "#002244",
    customerName: b.customer_id
      ? (customerById.get(b.customer_id)?.name ?? null)
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

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 py-6">
      <PageHeader
        title="Rink Schedule"
        description="Ice bookings across every surface. Times are the rink's own local clock."
        actions={
          <>
            {/* Front Desk is view-tier, same as this page, so it always
                renders — unlike Invoices/Insights/Requests/Contracts below,
                which show the money and stay edit-tier only. */}
            <Link
              href="/reports/rink-scheduling/desk"
              className="text-muted-foreground text-sm no-underline hover:underline"
            >
              Front Desk →
            </Link>
            {canEdit && (
              <>
                <Link
                  href="/reports/rink-scheduling/invoices"
                  className="text-muted-foreground text-sm no-underline hover:underline"
                >
                  Invoices →
                </Link>
                <Link
                  href="/reports/rink-scheduling/insights"
                  className="text-muted-foreground text-sm no-underline hover:underline"
                >
                  Insights →
                </Link>
                <Link
                  href="/reports/rink-scheduling/requests"
                  className="text-muted-foreground text-sm no-underline hover:underline"
                >
                  Requests →
                </Link>
                <Link
                  href="/reports/rink-scheduling/contracts"
                  className="text-muted-foreground text-sm no-underline hover:underline"
                >
                  Contracts →
                </Link>
              </>
            )}
          </>
        }
      />
      <CalendarClient
        view={view}
        focusKey={focusKey}
        todayKey={todayKey}
        timeZone={timeZone}
        rinks={rinks}
        bookingTypes={types}
        customers={customers}
        bookings={bookings}
        hours={(hoursRes.data ?? []) as OperatingHoursRow[]}
        exceptions={(exceptionsRes.data ?? []) as HoursExceptionRow[]}
        lockerRooms={lockerRooms}
        lockerAssignments={lockerAssignments}
        slotMinutes={settingsRes.data?.slot_increment_minutes ?? 30}
        bufferMinutes={settingsRes.data?.default_buffer_minutes ?? 15}
        selectedRinkId={explicitRinkId ?? rinks[0]?.id ?? null}
        explicitRinkId={explicitRinkId}
        showCancelled={params.showCancelled === "1"}
        gapsOnly={params.gaps === "1"}
        canCreate={canCreate || canEdit}
        canEdit={canEdit}
      />
    </div>
  )
}
