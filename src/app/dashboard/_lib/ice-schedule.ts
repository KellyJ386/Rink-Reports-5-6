// Server-only read for the dashboard's Ice Schedule widget.
//
// This module is DELIBERATELY read-only and imports nothing from
// src/app/reports/rink-scheduling/actions.ts, series-actions.ts,
// locker-actions.ts, or resurface-actions.ts (the module's mutation
// surface) — only Supabase SELECTs and the pure geometry helpers those
// action files also happen to use. facility_id is derived from the
// session (never a caller-supplied value), and the same RLS the full
// calendar reads under (rink_bookings_select, migration 248 — facility_id =
// current_facility_id() AND has_module_access('rink_scheduling')) applies
// here independently: this file's own facility_id filter is belt-and-braces,
// not the enforcement boundary.
//
// No Next.js data cache is used — the dashboard route already renders
// force-dynamic (src/app/dashboard/page.tsx), so every render is a fresh
// read and the "asOf" timestamp below is always accurate to it. If a cache
// is ever introduced here, asOf must be threaded through from the cached
// read's own time, never re-stamped at render — a stale schedule shown as
// current is worse than no schedule.

import "server-only"

import { getCurrentUser, requireUser } from "@/lib/auth"
import { getFacilityTimezone } from "@/lib/facility-timezone"
import { currentUserCan } from "@/lib/permissions/check"
import { createClient } from "@/lib/supabase/server"
import { addDaysToKey, dayKeyInTz } from "@/lib/timezone"

import {
  bookingMinutesOnDay,
  resolveDayWindow,
  type DayWindow,
} from "@/app/reports/rink-scheduling/_lib/grid-model"

import { buildRinkSchedules, type ReadOnlyBooking, type RinkTodaySchedule } from "./ice-schedule-model"

export type TodayIceSchedule = {
  todayKey: string
  timeZone: string | null
  /** When this read happened — render this, not "now", so a widget that
   *  ever gains a cache still tells the truth about its own freshness. */
  asOf: string
  window: DayWindow
  /** rink_scheduling `edit` (facility_manager and above) — gates the "Manage
   *  schedule" link. There is no separate admin route for the calendar
   *  itself (see the module notes); edit controls on /reports/rink-scheduling
   *  are permission-gated there, independently of this widget or its link. */
  canManage: boolean
  rinks: RinkTodaySchedule[]
}

export async function getTodayIceSchedule(): Promise<
  { ok: true; data: TodayIceSchedule } | { ok: false }
> {
  try {
    await requireUser()
    const current = await getCurrentUser()
    const facilityId = current?.profile?.facility_id
    if (!facilityId) return { ok: false }

    const supabase = await createClient()
    const [canView, canManage] = await Promise.all([
      currentUserCan(supabase, "rink_scheduling", "view"),
      currentUserCan(supabase, "rink_scheduling", "edit"),
    ])
    if (!canView) return { ok: false }

    const timeZone = await getFacilityTimezone(supabase, facilityId)
    const todayKey = dayKeyInTz(new Date(), timeZone)

    // Slack of one day on each side so a booking that starts before local
    // midnight but runs into today (or starts today and runs past it) still
    // shows — the identical convention reports/rink-scheduling/page.tsx uses
    // for its own window query.
    const queryFromKey = addDaysToKey(todayKey, -1)
    const queryToKey = addDaysToKey(todayKey, 1)

    const [rinksRes, typesRes, bookingsRes, hoursRes, exceptionRes] = await Promise.all([
      supabase
        .from("facility_rinks")
        .select("id, name, short_code, display_color")
        .eq("facility_id", facilityId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("rink_booking_types")
        .select("id, name, color, is_resurface")
        .eq("facility_id", facilityId),
      supabase
        .from("rink_bookings")
        .select(
          "id, rink_id, booking_type_id, customer_id, title, starts_at, ends_at, status, resurface_status",
        )
        .eq("facility_id", facilityId)
        .neq("status", "cancelled")
        .gte("starts_at", `${queryFromKey}T00:00:00.000Z`)
        .lte("starts_at", `${queryToKey}T23:59:59.999Z`)
        .order("starts_at", { ascending: true }),
      supabase
        .from("facility_operating_hours")
        .select("day_of_week, open_time, close_time, is_closed")
        .eq("facility_id", facilityId),
      supabase
        .from("facility_operating_hours_exceptions")
        .select("exception_date, open_time, close_time, is_closed, label")
        .eq("facility_id", facilityId)
        .eq("exception_date", todayKey),
    ])

    const rinks = rinksRes.data ?? []
    const types = typesRes.data ?? []
    const typeById = new Map(types.map((t) => [t.id, t]))

    const customerIds = [
      ...new Set(
        (bookingsRes.data ?? [])
          .map((b) => b.customer_id)
          .filter((id): id is string => id != null),
      ),
    ]
    const { data: customers } = customerIds.length
      ? await supabase.from("rink_customers").select("id, name").in("id", customerIds)
      : { data: [] as { id: string; name: string }[] }
    const customerNameById = new Map((customers ?? []).map((c) => [c.id, c.name]))

    const bookings: ReadOnlyBooking[] = (bookingsRes.data ?? [])
      .flatMap((b) => {
        const type = typeById.get(b.booking_type_id)
        // A booking whose type has since been removed has no color/name/
        // resurface flag to render — skip rather than guess at any of them.
        if (!type) return []
        const onToday = bookingMinutesOnDay(b.starts_at, b.ends_at, todayKey, timeZone)
        if (!onToday) return []
        return [
          {
            id: b.id,
            rinkId: b.rink_id,
            startMinute: onToday.startMinute,
            endMinute: onToday.endMinute,
            startsAtIso: b.starts_at,
            label: b.customer_id
              ? (customerNameById.get(b.customer_id) ?? type.name)
              : (b.title ?? type.name),
            typeColor: type.color,
            tentative: b.status === "tentative",
            isResurface: type.is_resurface,
            resurfaceStatus: b.resurface_status as ReadOnlyBooking["resurfaceStatus"],
          },
        ]
      })

    const asOf = new Date().toISOString()

    return {
      ok: true,
      data: {
        todayKey,
        timeZone,
        asOf,
        window: resolveDayWindow(todayKey, hoursRes.data ?? [], exceptionRes.data ?? []),
        canManage,
        rinks: buildRinkSchedules(
          rinks.map((r) => ({
            id: r.id,
            name: r.name,
            shortCode: r.short_code,
            color: r.display_color,
          })),
          bookings,
          asOf,
        ),
      },
    }
  } catch {
    return { ok: false }
  }
}
