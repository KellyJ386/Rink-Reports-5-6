import { Wrench } from "lucide-react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { requireUser } from "@/lib/auth"
import { getFacilityTimezone } from "@/lib/facility-timezone"
import { currentUserCan } from "@/lib/permissions/check"
import { createClient } from "@/lib/supabase/server"
import { addDaysToKey, dayKeyInTz, formatInTz, weekdayOfKey } from "@/lib/timezone"

import { NotAvailable } from "../_components/not-available"
import {
  buildDeskAgenda,
  deskDayOptions,
  nextPublicSkate,
  nextResurfacePerRink,
  type DeskBookingRow,
  type DeskRinkRow,
  type DeskTypeRow,
} from "../_lib/desk-agenda"
import { formatMinuteLabel } from "../_lib/grid-model"

export const dynamic = "force-dynamic"

export const metadata = { title: "Front Desk | MFO / Rink Reports" }

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

// The pinned widgets look ahead of the selected day, independent of it, so
// they need their own bounded window rather than "whatever the agenda
// fetched." 30 days is generous for finding the next resurface/Public Skate
// and still cheap: the query below filters to just the two pinned booking
// type ids, so widening this window doesn't widen the row count the way
// scanning every booking type would.
const PIN_WINDOW_DAYS = 30

/** Clock read outside the component body — "today" is the FACILITY's today,
 *  resolved from its zone, never the server's. */
function nowDate(): Date {
  return new Date()
}

function isResurfaceFilterable(type: DeskTypeRow): boolean {
  // A resurface isn't something a caller asks to filter to — it's ice-down
  // time, not a bookable slot — so it's excluded from the type picker even
  // though its bookings always render in the agenda.
  return !type.is_resurface
}

export default async function DeskPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; type?: string }>
}) {
  const current = await requireUser()
  const supabase = await createClient()

  if (!(await currentUserCan(supabase, "rink_scheduling", "view"))) {
    return <NotAvailable />
  }

  const facilityId = current.profile?.facility_id ?? null
  if (!facilityId) return <NotAvailable reason="no-facility" />

  const canEdit = await currentUserCan(supabase, "rink_scheduling", "edit")

  const timeZone = await getFacilityTimezone(supabase, facilityId)
  const now = nowDate()
  const todayKey = dayKeyInTz(now, timeZone)
  const dayOptions = deskDayOptions(todayKey)

  const params = await searchParams
  const selectedDayKey = dayOptions.includes(params.date ?? "") ? (params.date as string) : todayKey

  const [rinksRes, typesRes] = await Promise.all([
    supabase
      .from("facility_rinks")
      .select("id, name")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("rink_booking_types")
      .select("id, name, color, slug, is_resurface")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
  ])

  const rinks = (rinksRes.data ?? []) as DeskRinkRow[]
  const types = (typesRes.data ?? []) as DeskTypeRow[]
  const rinkById = new Map(rinks.map((r) => [r.id, r]))
  const typeById = new Map(types.map((t) => [t.id, t]))

  const selectedTypeId = types.some((t) => t.id === params.type) ? (params.type as string) : null

  // Same ±1-day slack as the calendar page (page.tsx): fromKey/toKey are
  // facility-LOCAL day keys, but starts_at is a UTC instant, so the bound is
  // widened a day on each side and the pure agenda builder re-clips to the
  // exact day.
  const queryFromKey = addDaysToKey(selectedDayKey, -1)
  const queryToKey = addDaysToKey(selectedDayKey, 1)
  const dayBookingsRes = await supabase
    .from("rink_bookings")
    .select("id, rink_id, booking_type_id, starts_at, ends_at, status, title, resurface_status")
    .eq("facility_id", facilityId)
    .gte("starts_at", `${queryFromKey}T00:00:00.000Z`)
    .lte("starts_at", `${queryToKey}T23:59:59.999Z`)
    .order("starts_at", { ascending: true })

  const agenda = buildDeskAgenda({
    bookings: (dayBookingsRes.data ?? []) as DeskBookingRow[],
    rinkById,
    typeById,
    dayKey: selectedDayKey,
    timeZone,
    typeFilterId: selectedTypeId,
  })

  // Pinned widgets: bounded to the structural types (every is_resurface
  // type — a facility can carry several, e.g. a game cut and a deep cut —
  // plus Public Skate) over a rolling window, independent of the selected
  // day. This is intentionally its own small query rather than folding into
  // the day fetch above, so flipping days on the phone never triggers a
  // wider scan than the one day being shown.
  const resurfaceTypeIds = types.filter((t) => t.is_resurface).map((t) => t.id)
  const publicSkateType = types.find((t) => t.slug === "public-skate")
  const pinnedTypeIds = [...resurfaceTypeIds, publicSkateType?.id].filter(
    (id): id is string => Boolean(id),
  )

  const pinFromIso = now.toISOString()
  const pinToIso = new Date(now.getTime() + PIN_WINDOW_DAYS * 86_400_000).toISOString()
  const pinnedBookingsRes = pinnedTypeIds.length
    ? await supabase
        .from("rink_bookings")
        .select("id, rink_id, booking_type_id, starts_at, ends_at, status, title, resurface_status")
        .eq("facility_id", facilityId)
        .in("booking_type_id", pinnedTypeIds)
        .gte("ends_at", pinFromIso)
        .lte("starts_at", pinToIso)
        .order("starts_at", { ascending: true })
    : { data: [] }

  const pinnedBookings = (pinnedBookingsRes.data ?? []) as DeskBookingRow[]
  const resurfaceByRink = nextResurfacePerRink({
    bookings: pinnedBookings,
    rinkIds: rinks.map((r) => r.id),
    typeById,
    nowMs: now.getTime(),
  })
  const nextSkate = nextPublicSkate({ bookings: pinnedBookings, typeById, nowMs: now.getTime() })

  const filterableTypes = types.filter(isResurfaceFilterable)

  function dayHref(dayKey: string): string {
    const sp = new URLSearchParams()
    sp.set("date", dayKey)
    if (selectedTypeId) sp.set("type", selectedTypeId)
    return `/reports/rink-scheduling/desk?${sp.toString()}`
  }

  function typeHref(typeId: string | null): string {
    const sp = new URLSearchParams()
    sp.set("date", selectedDayKey)
    if (typeId) sp.set("type", typeId)
    return `/reports/rink-scheduling/desk?${sp.toString()}`
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <PageHeader
        title="Front Desk"
        description="Quick lookup for phone questions about upcoming ice availability."
        actions={
          <>
            <Link
              href="/reports/rink-scheduling"
              className="text-muted-foreground text-sm no-underline hover:underline"
            >
              ← Calendar
            </Link>
            {canEdit && (
              <Button asChild variant="outline" size="sm">
                <Link href="/reports/rink-scheduling">Open full grid</Link>
              </Button>
            )}
          </>
        }
      />

      <p className="text-muted-foreground text-xs">
        Last updated {formatInTz(now, timeZone, { hour: "numeric", minute: "2-digit", second: "2-digit" })}
      </p>

      <PinnedWidgets
        rinks={rinks}
        resurfaceByRink={resurfaceByRink}
        nextSkate={nextSkate}
        timeZone={timeZone}
        todayKey={todayKey}
      />

      <div className="flex flex-wrap gap-1.5">
        {dayOptions.map((dayKey) => (
          <Button
            key={dayKey}
            asChild
            variant={dayKey === selectedDayKey ? "default" : "outline"}
            size="sm"
          >
            <Link href={dayHref(dayKey)}>
              {dayKey === todayKey ? "Today" : DAY_NAMES[weekdayOfKey(dayKey)]}{" "}
              <span className="font-mono tabular-nums">{dayKey.slice(5)}</span>
            </Link>
          </Button>
        ))}
      </div>

      {filterableTypes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <Button asChild variant={selectedTypeId === null ? "secondary" : "ghost"} size="sm">
            <Link href={typeHref(null)}>All types</Link>
          </Button>
          {filterableTypes.map((t) => (
            <Button
              key={t.id}
              asChild
              variant={selectedTypeId === t.id ? "secondary" : "ghost"}
              size="sm"
            >
              <Link href={typeHref(t.id)}>{t.name}</Link>
            </Button>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="flex flex-col gap-2 py-4">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="font-semibold">
              {DAY_NAMES[weekdayOfKey(selectedDayKey)]} {selectedDayKey}
            </h2>
            {selectedDayKey === todayKey && <Badge variant="secondary">Today</Badge>}
          </div>

          {agenda.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              Nothing scheduled{selectedTypeId ? " for this type" : ""} on this day.
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {agenda.map((row) => (
                <li
                  key={row.bookingId}
                  className={
                    row.isResurface
                      ? "border-dashed flex w-full flex-wrap items-center gap-3 bg-muted/30 py-2"
                      : "flex w-full flex-wrap items-center gap-3 py-2"
                  }
                >
                  <span className="w-36 shrink-0 font-mono text-sm tabular-nums">
                    {formatMinuteLabel(row.startMinute)} – {formatMinuteLabel(row.endMinute)}
                  </span>
                  <span
                    aria-hidden
                    className="size-3 shrink-0 rounded-sm border"
                    style={{ backgroundColor: row.typeColor }}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {row.isResurface ? (
                      <span className="text-muted-foreground inline-flex items-center gap-1">
                        <Wrench className="size-3.5" aria-hidden /> {row.label}
                      </span>
                    ) : (
                      row.label
                    )}
                  </span>
                  <span className="text-muted-foreground font-mono text-xs">{row.rinkName}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function PinnedWidgets({
  rinks,
  resurfaceByRink,
  nextSkate,
  timeZone,
  todayKey,
}: {
  rinks: DeskRinkRow[]
  resurfaceByRink: Map<string, { rinkId: string; startsAt: string; endsAt: string } | null>
  nextSkate: { rinkId: string; startsAt: string; endsAt: string } | null
  timeZone: string | null
  todayKey: string
}) {
  const rinkName = new Map(rinks.map((r) => [r.id, r.name]))

  function whenLabel(iso: string): string {
    const dayKey = dayKeyInTz(iso, timeZone)
    const time = formatInTz(iso, timeZone, { hour: "numeric", minute: "2-digit" })
    return dayKey === todayKey ? `Today, ${time}` : `${formatInTz(iso, timeZone, { month: "short", day: "numeric" })}, ${time}`
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Card>
        <CardContent className="flex flex-col gap-2 py-4">
          <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Next resurface
          </h2>
          {rinks.length === 0 ? (
            <p className="text-muted-foreground text-sm">No active rinks configured.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {rinks.map((r) => {
                const next = resurfaceByRink.get(r.id) ?? null
                return (
                  <li key={r.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">{rinkName.get(r.id)}</span>
                    <span className="text-muted-foreground font-mono text-xs tabular-nums">
                      {next ? whenLabel(next.startsAt) : "None scheduled"}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 py-4">
          <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Next Public Skate
          </h2>
          {nextSkate ? (
            <p className="text-sm">
              <span className="font-medium">{whenLabel(nextSkate.startsAt)}</span>{" "}
              <span className="text-muted-foreground">· {rinkName.get(nextSkate.rinkId) ?? "Rink"}</span>
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">None scheduled.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
