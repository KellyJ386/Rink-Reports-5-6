"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  bookingsInWindow,
  putCalendar,
  type CachedBooking,
} from "@/lib/offline/calendar-cache"
import { createClient } from "@/lib/supabase/client"
import { addDaysToKey, formatInTz, weekdayOfKey } from "@/lib/timezone"

import { BookingSheet } from "./booking-sheet"
import { FindSlotSheet } from "./find-slot-sheet"
import { SeriesSheet } from "./series-sheet"
import {
  blockGeometry,
  bookingMinutesOnDay,
  formatMinuteLabel,
  gridExtent,
  hourTicks,
  resolveDayWindow,
  type DayWindow,
} from "../_lib/grid-model"
import {
  addMonthsToKey,
  buildMonthGrid,
  monthLabel,
  type MonthCell,
} from "../_lib/month-model"
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
} from "../_lib/types"
import { CALENDAR_VIEWS } from "../_lib/types"

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

type Props = {
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
  /** rink_scheduling_settings.default_resurface_minutes, raw. Null when the
   *  facility has no settings row; resolveResurfaceMinutes() owns the
   *  fallback. */
  resurfaceDefaultMinutes: number | null
  selectedRinkId: string | null
  /** The `rink` query param as given, WITHOUT the day/week fallback to the
   *  first rink. The month view shows every rink unless one was explicitly
   *  chosen, so it needs to tell "none picked" from "picked the first". */
  explicitRinkId: string | null
  showCancelled: boolean
  gapsOnly: boolean
  canCreate: boolean
  canEdit: boolean
}

type SheetState =
  | { mode: "closed" }
  | { mode: "create"; rinkId: string; dayKey: string; startMinute: number }
  | { mode: "edit"; booking: BookingView }

export function CalendarClient(props: Props) {
  const {
    view,
    focusKey,
    todayKey,
    rinks,
    bookings,
    hours,
    exceptions,
    showCancelled,
    gapsOnly,
    canCreate,
  } = props

  const [sheet, setSheet] = useState<SheetState>({ mode: "closed" })
  const [seriesOpen, setSeriesOpen] = useState(false)
  const [finderOpen, setFinderOpen] = useState(false)

  useCalendarCacheWriter(props)

  const visible = useMemo(
    () =>
      bookings.filter((b) => {
        if (!showCancelled && b.status === "cancelled") return false
        if (gapsOnly && b.coverage_status === "covered") return false
        return true
      }),
    [bookings, showCancelled, gapsOnly],
  )

  const futureGapCount = useMemo(
    () =>
      bookings.filter(
        (b) => b.status !== "cancelled" && b.coverage_status !== "covered",
      ).length,
    [bookings],
  )

  if (rinks.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 py-8 text-center">
          <p className="font-medium">No rinks are set up yet</p>
          <p className="text-muted-foreground text-sm">
            An administrator needs to add at least one ice surface before
            anything can be booked.
          </p>
          <div>
            <Button asChild variant="outline">
              <Link href="/admin/rink-scheduling">Open Rink Scheduling admin</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        {...props}
        futureGapCount={futureGapCount}
        onNewSeries={() => setSeriesOpen(true)}
        onFindSlot={() => setFinderOpen(true)}
      />

      {view === "day" && (
        <DayGrid
          {...props}
          bookings={visible}
          onCreate={(rinkId, startMinute) =>
            setSheet({ mode: "create", rinkId, dayKey: focusKey, startMinute })
          }
          onOpen={(booking) => setSheet({ mode: "edit", booking })}
        />
      )}

      {view === "week" && (
        <WeekGrid
          {...props}
          bookings={visible}
          onCreate={(dayKey, startMinute) =>
            setSheet({
              mode: "create",
              rinkId: props.selectedRinkId ?? rinks[0].id,
              dayKey,
              startMinute,
            })
          }
          onOpen={(booking) => setSheet({ mode: "edit", booking })}
        />
      )}

      {view === "month" && (
        <MonthGrid
          {...props}
          bookings={visible}
          onCreate={(dayKey) =>
            setSheet({
              mode: "create",
              rinkId: props.explicitRinkId ?? props.selectedRinkId ?? rinks[0].id,
              dayKey,
              // A month cell has no time axis to pick from, so a new booking
              // opens at the facility's opening minute for that day and the
              // sheet's own time fields take it from there. A CLOSED day has
              // no opening minute (resolveDayWindow says 0 = midnight), so it
              // borrows gridExtent's closed-day convention of 6 AM instead —
              // booking a closed day is allowed, it just flags for coverage.
              startMinute: monthCreateStartMinute(
                resolveDayWindow(dayKey, hours, exceptions),
              ),
            })
          }
          onOpen={(booking) => setSheet({ mode: "edit", booking })}
        />
      )}

      {view === "list" && (
        <AgendaList
          bookings={visible}
          timeZone={props.timeZone}
          focusKey={focusKey}
          todayKey={todayKey}
          hours={hours}
          exceptions={exceptions}
          onOpen={(booking) => setSheet({ mode: "edit", booking })}
        />
      )}

      {finderOpen && (
        <FindSlotSheet
          rinks={rinks}
          defaultDayKey={focusKey < todayKey ? todayKey : focusKey}
          onPick={(rinkId, dayKey, startMinute) => {
            setFinderOpen(false)
            setSheet({ mode: "create", rinkId, dayKey, startMinute })
          }}
          onClose={() => setFinderOpen(false)}
        />
      )}

      {seriesOpen && (
        <SeriesSheet
          rinks={rinks}
          bookingTypes={props.bookingTypes}
          customers={props.customers}
          defaultDayKey={focusKey}
          canEdit={props.canEdit}
          onClose={() => setSeriesOpen(false)}
        />
      )}

      {sheet.mode !== "closed" && (
        <BookingSheet
          state={sheet}
          rinks={rinks}
          bookingTypes={props.bookingTypes}
          customers={props.customers}
          timeZone={props.timeZone}
          lockerRooms={props.lockerRooms}
          lockerAssignments={props.lockerAssignments}
          slotMinutes={props.slotMinutes}
          resurfaceDefaultMinutes={props.resurfaceDefaultMinutes}
          canCreate={canCreate}
          canEdit={props.canEdit}
          onClose={() => setSheet({ mode: "closed" })}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function Toolbar({
  view,
  focusKey,
  todayKey,
  rinks,
  selectedRinkId,
  explicitRinkId,
  showCancelled,
  gapsOnly,
  futureGapCount,
  canCreate,
  canEdit,
  onNewSeries,
  onFindSlot,
}: Props & { futureGapCount: number; onNewSeries: () => void; onFindSlot: () => void }) {
  function href(next: Partial<Record<string, string>>): string {
    const sp = new URLSearchParams()
    sp.set("view", next.view ?? view)
    sp.set("date", next.date ?? focusKey)
    // Only an EXPLICIT rink choice survives navigation. selectedRinkId is
    // the server-side first-rink fallback, and writing it into the URL turns
    // "no choice" into a sticky choice — which is exactly what silently
    // narrowed the month view's all-rinks default to rink 1 on any toolbar
    // click. An explicit pick (from the URL or a rink button) still carries.
    const rink = next.rink ?? explicitRinkId ?? ""
    if (rink) sp.set("rink", rink)
    if ((next.showCancelled ?? (showCancelled ? "1" : "")) === "1") {
      sp.set("showCancelled", "1")
    }
    if ((next.gaps ?? (gapsOnly ? "1" : "")) === "1") sp.set("gaps", "1")
    return `/reports/rink-scheduling?${sp.toString()}`
  }

  // Month pages by whole calendar months; a fixed day step would drift through
  // months of unequal length.
  const stepBy = (n: number) =>
    view === "month"
      ? addMonthsToKey(focusKey, n)
      : addDaysToKey(focusKey, n * (view === "week" ? 7 : 1))

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <div className="flex items-center gap-1">
        <Button asChild variant="outline" size="sm">
          <Link href={href({ date: stepBy(-1) })} aria-label="Previous">
            ←
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={href({ date: todayKey })}>Today</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={href({ date: stepBy(1) })} aria-label="Next">
            →
          </Link>
        </Button>
      </div>

      <span className="font-mono text-sm tabular-nums">
        {view === "month" ? monthLabel(focusKey) : focusKey}
      </span>

      <div className="flex items-center gap-1">
        {CALENDAR_VIEWS.map((v) => (
          <Button
            key={v.key}
            asChild
            variant={v.key === view ? "default" : "outline"}
            size="sm"
          >
            <Link href={href({ view: v.key })}>{v.label}</Link>
          </Button>
        ))}
      </div>

      {(view === "week" || view === "month") && rinks.length > 1 && (
        <div className="flex items-center gap-1">
          {view === "month" && (
            <Button
              asChild
              variant={explicitRinkId ? "outline" : "default"}
              size="sm"
            >
              <Link href={href({ rink: "" })}>All</Link>
            </Button>
          )}
          {rinks.map((r) => (
            <Button
              key={r.id}
              asChild
              variant={
                (view === "month" ? explicitRinkId : selectedRinkId) === r.id
                  ? "default"
                  : "outline"
              }
              size="sm"
            >
              <Link href={href({ rink: r.id })}>{r.short_code}</Link>
            </Button>
          ))}
        </div>
      )}

      <div className="ml-auto flex items-center gap-1">
        {/* Search is view-tier (it reveals only what the calendar shows), but
            surfacing it to accounts that can then BOOK the result is where it
            earns its place, so the button follows canCreate. */}
        {canCreate && (
          <Button variant="outline" size="sm" onClick={onFindSlot}>
            Find a slot
          </Button>
        )}
        {/* The agenda doubles as the printed daily schedule; shell chrome and
            this toolbar are all print:hidden, so what comes out is the list. */}
        {view === "list" && (
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            Print
          </Button>
        )}
        {canEdit && (
          <Button variant="outline" size="sm" onClick={onNewSeries}>
            New series
          </Button>
        )}
        <Button asChild variant={gapsOnly ? "default" : "outline"} size="sm">
          <Link href={href({ gaps: gapsOnly ? "" : "1" })}>
            Coverage gaps
            {futureGapCount > 0 && (
              <Badge variant="secondary" className="ml-1.5">
                {futureGapCount}
              </Badge>
            )}
          </Link>
        </Button>
        <Button asChild variant={showCancelled ? "default" : "outline"} size="sm">
          <Link href={href({ showCancelled: showCancelled ? "" : "1" })}>
            Show cancelled
          </Link>
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Day view — rinks as columns, time down the Y axis.
// ---------------------------------------------------------------------------

function DayGrid({
  focusKey,
  timeZone,
  rinks,
  bookings,
  hours,
  exceptions,
  slotMinutes,
  canCreate,
  onCreate,
  onOpen,
}: Props & {
  onCreate: (rinkId: string, startMinute: number) => void
  onOpen: (b: BookingView) => void
}) {
  const window = resolveDayWindow(focusKey, hours, exceptions)

  const placed = rinks.map((rink) => ({
    rink,
    items: bookings
      .filter((b) => b.rink_id === rink.id)
      .map((b) => {
        const m = bookingMinutesOnDay(b.starts_at, b.ends_at, focusKey, timeZone)
        return m ? { booking: b, ...m } : null
      })
      .filter((x): x is { booking: BookingView; startMinute: number; endMinute: number } => x !== null),
  }))

  const extent = gridExtent(
    window,
    placed.flatMap((c) => c.items),
  )
  const ticks = hourTicks(extent.startMinute, extent.endMinute)
  const gridHeight = Math.max(560, ((extent.endMinute - extent.startMinute) / 60) * 56)

  return (
    <Card>
      <CardContent className="p-0">
        {window.isClosed && (
          <p className="text-muted-foreground border-b px-4 py-2 text-sm">
            {window.exceptionLabel
              ? `Closed — ${window.exceptionLabel}.`
              : "The facility is closed on this day."}{" "}
            Bookings can still be made; they will be flagged for coverage.
          </p>
        )}
        {!window.isClosed && window.exceptionLabel && (
          <p className="text-muted-foreground border-b px-4 py-2 text-sm">
            {window.exceptionLabel} — {formatMinuteLabel(window.openMinute)} to{" "}
            {formatMinuteLabel(window.closeMinute)}.
          </p>
        )}

        <div className="overflow-x-auto">
          <div className="flex min-w-[640px]">
            <TimeAxis ticks={ticks} extent={extent} height={gridHeight} />
            {placed.map((col) => (
              <div key={col.rink.id} className="min-w-40 flex-1 border-l">
                <div className="bg-muted/40 flex items-center gap-2 border-b px-2 py-1.5">
                  <span
                    aria-hidden
                    className="size-3 shrink-0 rounded-sm border"
                    style={{ backgroundColor: col.rink.display_color }}
                  />
                  <span className="truncate text-sm font-medium">
                    {col.rink.name}
                  </span>
                </div>
                <div className="relative" style={{ height: gridHeight }}>
                  <HourLines ticks={ticks} extent={extent} />
                  <ClosedShading window={window} extent={extent} />
                  {canCreate && (
                    <CreateOverlay
                      extent={extent}
                      slotMinutes={slotMinutes}
                      onPick={(minute) => onCreate(col.rink.id, minute)}
                      label={`Add a booking on ${col.rink.name}`}
                    />
                  )}
                  {col.items.map((item) => (
                    <BookingBlock
                      key={item.booking.id}
                      booking={item.booking}
                      startMinute={item.startMinute}
                      endMinute={item.endMinute}
                      extent={extent}
                      onOpen={onOpen}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Week view — one rink, days as columns.
// ---------------------------------------------------------------------------

function WeekGrid({
  focusKey,
  timeZone,
  rinks,
  bookings,
  hours,
  exceptions,
  slotMinutes,
  selectedRinkId,
  canCreate,
  todayKey,
  onCreate,
  onOpen,
}: Props & {
  onCreate: (dayKey: string, startMinute: number) => void
  onOpen: (b: BookingView) => void
}) {
  const rink = rinks.find((r) => r.id === selectedRinkId) ?? rinks[0]

  // Weeks start on Sunday, matching facility_operating_hours.day_of_week.
  const weekStart = addDaysToKey(focusKey, -weekdayOfKey(focusKey))
  const days = Array.from({ length: 7 }, (_, i) => addDaysToKey(weekStart, i))

  const columns = days.map((dayKey) => {
    const window = resolveDayWindow(dayKey, hours, exceptions)
    const items = bookings
      .filter((b) => b.rink_id === rink.id)
      .map((b) => {
        const m = bookingMinutesOnDay(b.starts_at, b.ends_at, dayKey, timeZone)
        return m ? { booking: b, ...m } : null
      })
      .filter((x): x is { booking: BookingView; startMinute: number; endMinute: number } => x !== null)
    return { dayKey, window, items }
  })

  const extent = gridExtent(
    columns[0]?.window ?? { openMinute: 360, closeMinute: 1380, isClosed: false, wrapsMidnight: false, exceptionLabel: null },
    columns.flatMap((c) => c.items),
  )
  const ticks = hourTicks(extent.startMinute, extent.endMinute)
  const gridHeight = Math.max(560, ((extent.endMinute - extent.startMinute) / 60) * 52)

  return (
    <Card>
      <CardContent className="p-0">
        <p className="text-muted-foreground border-b px-4 py-2 text-sm">
          {rink.name} · week of {weekStart}
        </p>
        <div className="overflow-x-auto">
          <div className="flex min-w-[860px]">
            <TimeAxis ticks={ticks} extent={extent} height={gridHeight} />
            {columns.map((col) => (
              <div key={col.dayKey} className="min-w-28 flex-1 border-l">
                <div
                  className={`flex items-baseline gap-1 border-b px-2 py-1.5 ${
                    col.dayKey === todayKey ? "bg-primary/10" : "bg-muted/40"
                  }`}
                >
                  <span className="text-sm font-medium">
                    {DAY_NAMES[weekdayOfKey(col.dayKey)]}
                  </span>
                  <span className="text-muted-foreground font-mono text-xs">
                    {col.dayKey.slice(8)}
                  </span>
                </div>
                <div className="relative" style={{ height: gridHeight }}>
                  <HourLines ticks={ticks} extent={extent} />
                  <ClosedShading window={col.window} extent={extent} />
                  {canCreate && (
                    <CreateOverlay
                      extent={extent}
                      slotMinutes={slotMinutes}
                      onPick={(minute) => onCreate(col.dayKey, minute)}
                      label={`Add a booking on ${col.dayKey}`}
                    />
                  )}
                  {col.items.map((item) => (
                    <BookingBlock
                      key={`${col.dayKey}-${item.booking.id}`}
                      booking={item.booking}
                      startMinute={item.startMinute}
                      endMinute={item.endMinute}
                      extent={extent}
                      compact
                      onOpen={onOpen}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}


// ---------------------------------------------------------------------------
// Month view — a date grid, not a time axis.
//
// The other two views answer "when in the day"; this one answers "which days".
// So a cell is a list of chips rather than positioned blocks, and the things
// worth seeing from across the room are the day's load and whether anything on
// it has an unresolved coverage gap.
//
// All rinks by default: the point of a month is the whole building at a glance.
// The toolbar's rink buttons narrow it, and "All" clears that.
// ---------------------------------------------------------------------------

/** Chips shown before a cell collapses the rest into "+N more". Four keeps a
 *  six-row grid on one screen at laptop height. */
const MONTH_CELL_CHIPS = 4

/** Opening minute a month-cell create starts at. Mirrors gridExtent's
 *  closed-day fallback (6 AM) so a closed-day booking doesn't open at
 *  midnight. */
function monthCreateStartMinute(window: DayWindow): number {
  return window.isClosed ? 6 * 60 : window.openMinute
}

function MonthGrid({
  focusKey,
  todayKey,
  timeZone,
  bookings,
  hours,
  exceptions,
  explicitRinkId,
  showCancelled,
  gapsOnly,
  canCreate,
  onCreate,
  onOpen,
}: Props & {
  onCreate: (dayKey: string) => void
  onOpen: (b: BookingView) => void
}) {
  const grid = buildMonthGrid(focusKey, bookings, timeZone, todayKey, {
    rinkId: explicitRinkId,
    showCancelled,
  })

  return (
    <Card>
      <CardContent className="p-0">
        <p className="text-muted-foreground border-b px-4 py-2 text-sm">
          {monthLabel(grid.monthKey)} · {grid.monthLiveCount}{" "}
          {grid.monthLiveCount === 1 ? "booking" : "bookings"}
          {/* The gaps filter has already narrowed `bookings`, so say so rather
              than presenting a filtered count as the month's total. */}
          {gapsOnly ? " with coverage gaps" : ""}
        </p>

        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="bg-muted/40 grid grid-cols-7 border-b">
              {DAY_NAMES.map((name) => (
                <div
                  key={name}
                  className="text-muted-foreground px-2 py-1.5 text-xs font-medium"
                >
                  {name}
                </div>
              ))}
            </div>

            {grid.weeks.map((week) => (
              <div key={week[0].dayKey} className="grid grid-cols-7 border-b last:border-b-0">
                {week.map((cell) => (
                  <MonthCellView
                    key={cell.dayKey}
                    cell={cell}
                    window={resolveDayWindow(cell.dayKey, hours, exceptions)}
                    timeZone={timeZone}
                    canCreate={canCreate}
                    onCreate={onCreate}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function MonthCellView({
  cell,
  window,
  timeZone,
  canCreate,
  onCreate,
  onOpen,
}: {
  cell: MonthCell<BookingView>
  window: DayWindow
  timeZone: string | null
  canCreate: boolean
  onCreate: (dayKey: string) => void
  onOpen: (b: BookingView) => void
}) {
  const shown = cell.bookings.slice(0, MONTH_CELL_CHIPS)
  const overflow = cell.bookings.length - shown.length

  return (
    <div
      className={`min-h-28 border-r p-1.5 last:border-r-0 ${
        cell.inMonth ? "" : "bg-muted/30"
      } ${window.isClosed ? "bg-muted/50" : ""}`}
    >
      <div className="mb-1 flex items-center justify-between gap-1">
        <span
          className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 font-mono text-xs tabular-nums ${
            cell.isToday
              ? "bg-primary text-primary-foreground font-semibold"
              : cell.inMonth
                ? "text-foreground"
                : "text-muted-foreground"
          }`}
        >
          {cell.dayOfMonth}
        </span>

        <span className="flex items-center gap-1">
          {cell.hasCoverageGap && (
            <span
              className="bg-destructive inline-block size-2 rounded-full"
              title="A booking on this day has a coverage gap"
              aria-label="Coverage gap"
            />
          )}
          {/* The '+' renders on closed days too: the day view's own banner
              says "Bookings can still be made; they will be flagged for
              coverage", and the month view must not be stricter than the
              policy it summarizes. */}
          {canCreate && (
            <button
              type="button"
              onClick={() => onCreate(cell.dayKey)}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded px-1 text-sm leading-none focus-visible:ring-2 focus-visible:outline-none"
              aria-label={`Add a booking on ${cell.dayKey}`}
            >
              +
            </button>
          )}
        </span>
      </div>

      {window.isClosed && cell.bookings.length === 0 ? (
        <p className="text-muted-foreground px-0.5 text-[10px]">Closed</p>
      ) : null}

      <ul className="flex flex-col gap-0.5">
        {shown.map((booking) => (
          <li key={booking.id}>
            <MonthChip booking={booking} timeZone={timeZone} onOpen={onOpen} />
          </li>
        ))}
      </ul>

      {overflow > 0 && (
        <p className="text-muted-foreground mt-0.5 px-0.5 text-[10px]">
          +{overflow} more
        </p>
      )}
    </div>
  )
}

function MonthChip({
  booking,
  timeZone,
  onOpen,
}: {
  booking: BookingView
  timeZone: string | null
  onOpen: (b: BookingView) => void
}) {
  const cancelled = booking.status === "cancelled"
  return (
    <button
      type="button"
      onClick={() => onOpen(booking)}
      className={`focus-visible:ring-ring flex w-full items-center gap-1 overflow-hidden rounded border px-1 py-0.5 text-left focus-visible:ring-2 focus-visible:outline-none ${
        cancelled ? "opacity-50 line-through" : ""
      }`}
      style={{
        backgroundColor: `color-mix(in oklab, ${booking.typeColor} 18%, var(--color-card))`,
        borderColor: booking.typeColor,
      }}
    >
      <span className="shrink-0 font-mono text-[10px] tabular-nums">
        {formatInTz(booking.starts_at, timeZone, {
          hour: "numeric",
          minute: "2-digit",
        })}
      </span>
      <span className="truncate text-[11px]">
        {booking.customerName ?? booking.title ?? booking.typeName}
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Agenda — also the printable daily schedule.
// ---------------------------------------------------------------------------

function AgendaList({
  bookings,
  timeZone,
  focusKey,
  todayKey,
  hours,
  exceptions,
  onOpen,
}: {
  bookings: BookingView[]
  timeZone: string | null
  focusKey: string
  todayKey: string
  hours: OperatingHoursRow[]
  exceptions: HoursExceptionRow[]
  onOpen: (b: BookingView) => void
}) {
  const days = Array.from({ length: 14 }, (_, i) => addDaysToKey(focusKey, i))

  return (
    <div className="flex flex-col gap-4">
      {days.map((dayKey) => {
        const items = bookings
          .map((b) => {
            const m = bookingMinutesOnDay(b.starts_at, b.ends_at, dayKey, timeZone)
            return m ? { booking: b, ...m } : null
          })
          .filter((x): x is { booking: BookingView; startMinute: number; endMinute: number } => x !== null)
          .sort((a, b) => a.startMinute - b.startMinute)

        if (items.length === 0) return null
        const window = resolveDayWindow(dayKey, hours, exceptions)

        return (
          <Card key={dayKey} className="print:break-inside-avoid print:border-0 print:shadow-none">
            <CardContent className="flex flex-col gap-2 py-4 print:px-0">
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 className="font-semibold">
                  {DAY_NAMES[weekdayOfKey(dayKey)]} {dayKey}
                </h2>
                {dayKey === todayKey && <Badge variant="secondary">Today</Badge>}
                {window.isClosed && (
                  <span className="text-muted-foreground text-xs">
                    facility closed
                  </span>
                )}
              </div>
              <ul className="flex flex-col divide-y">
                {items.map((item) => (
                  <li key={item.booking.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(item.booking)}
                      className="hover:bg-muted/40 focus-visible:ring-ring flex w-full flex-wrap items-center gap-3 py-2 text-left focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <span className="w-36 shrink-0 font-mono text-sm tabular-nums">
                        {formatMinuteLabel(item.startMinute)} –{" "}
                        {formatMinuteLabel(item.endMinute)}
                      </span>
                      <span
                        aria-hidden
                        className="size-3 shrink-0 rounded-sm border"
                        style={{ backgroundColor: item.booking.typeColor }}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {item.booking.customerName ?? item.booking.title ?? item.booking.typeName}
                      </span>
                      <span className="text-muted-foreground font-mono text-xs">
                        {item.booking.rinkShortCode}
                      </span>
                      <StatusChips booking={item.booking} />
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared grid pieces
// ---------------------------------------------------------------------------

function TimeAxis({
  ticks,
  extent,
  height,
}: {
  ticks: number[]
  extent: { startMinute: number; endMinute: number }
  height: number
}) {
  const span = extent.endMinute - extent.startMinute
  return (
    <div className="w-16 shrink-0">
      <div className="bg-muted/40 border-b px-2 py-1.5 text-xs font-medium">
        Time
      </div>
      <div className="relative" style={{ height }}>
        {ticks.map((t) => (
          <span
            key={t}
            className="text-muted-foreground absolute right-1 -translate-y-1/2 font-mono text-[10px] tabular-nums"
            style={{ top: `${((t - extent.startMinute) / span) * 100}%` }}
          >
            {formatMinuteLabel(t)}
          </span>
        ))}
      </div>
    </div>
  )
}

function HourLines({
  ticks,
  extent,
}: {
  ticks: number[]
  extent: { startMinute: number; endMinute: number }
}) {
  const span = extent.endMinute - extent.startMinute
  return (
    <>
      {ticks.map((t) => (
        <div
          key={t}
          aria-hidden
          className="border-border/60 pointer-events-none absolute inset-x-0 border-t"
          style={{ top: `${((t - extent.startMinute) / span) * 100}%` }}
        />
      ))}
    </>
  )
}

/** Out-of-hours time is shaded, never hidden: booking outside hours is allowed,
 *  it simply raises a coverage flag. */
function ClosedShading({
  window,
  extent,
}: {
  window: ReturnType<typeof resolveDayWindow>
  extent: { startMinute: number; endMinute: number }
}) {
  const span = extent.endMinute - extent.startMinute
  if (window.isClosed) {
    return (
      <div
        aria-hidden
        className="bg-muted/50 pointer-events-none absolute inset-0"
      />
    )
  }

  const bands: Array<{ top: number; height: number }> = []
  if (window.openMinute > extent.startMinute) {
    bands.push({
      top: 0,
      height: ((window.openMinute - extent.startMinute) / span) * 100,
    })
  }
  if (!window.wrapsMidnight && window.closeMinute < extent.endMinute) {
    bands.push({
      top: ((window.closeMinute - extent.startMinute) / span) * 100,
      height: ((extent.endMinute - window.closeMinute) / span) * 100,
    })
  }

  return (
    <>
      {bands.map((b, i) => (
        <div
          key={i}
          aria-hidden
          className="bg-muted/50 pointer-events-none absolute inset-x-0"
          style={{ top: `${b.top}%`, height: `${b.height}%` }}
        />
      ))}
    </>
  )
}

/** Click an empty slot to start a booking there. Keyboard users get the same
 *  affordance through the button, which is why this is a real <button> per
 *  slot rather than a mousedown handler on the column. */
function CreateOverlay({
  extent,
  slotMinutes,
  onPick,
  label,
}: {
  extent: { startMinute: number; endMinute: number }
  slotMinutes: number
  onPick: (minute: number) => void
  label: string
}) {
  const step = slotMinutes > 0 ? slotMinutes : 30
  const slots: number[] = []
  for (let m = extent.startMinute; m < extent.endMinute; m += step) slots.push(m)
  const span = extent.endMinute - extent.startMinute

  return (
    <>
      {slots.map((m) => (
        <button
          key={m}
          type="button"
          aria-label={`${label} at ${formatMinuteLabel(m)}`}
          onClick={() => onPick(m)}
          className="hover:bg-primary/10 focus-visible:ring-ring absolute inset-x-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none"
          style={{
            top: `${((m - extent.startMinute) / span) * 100}%`,
            height: `${(step / span) * 100}%`,
          }}
        />
      ))}
    </>
  )
}

function BookingBlock({
  booking,
  startMinute,
  endMinute,
  extent,
  compact = false,
  onOpen,
}: {
  booking: BookingView
  startMinute: number
  endMinute: number
  extent: { startMinute: number; endMinute: number }
  compact?: boolean
  onOpen: (b: BookingView) => void
}) {
  const geo = blockGeometry(
    startMinute,
    endMinute,
    booking.buffer_minutes_after ?? 0,
    extent,
  )
  const cancelled = booking.status === "cancelled"
  const gapped = booking.coverage_status !== "covered"

  return (
    <>
      <button
        type="button"
        onClick={() => onOpen(booking)}
        className={`focus-visible:ring-ring absolute inset-x-1 overflow-hidden rounded-md border px-1.5 py-1 text-left focus-visible:ring-2 focus-visible:outline-none ${
          cancelled ? "opacity-50 line-through" : ""
        }`}
        style={{
          top: `${geo.topPct}%`,
          height: `${geo.heightPct}%`,
          backgroundColor: `color-mix(in oklab, ${booking.typeColor} 18%, var(--color-card))`,
          borderColor: booking.typeColor,
        }}
      >
        <span className="block truncate font-mono text-[10px] tabular-nums">
          {formatMinuteLabel(startMinute)}–{formatMinuteLabel(endMinute)}
        </span>
        <span className="block truncate text-xs font-medium">
          {booking.customerName ?? booking.title ?? booking.typeName}
        </span>
        {!compact && (
          <span className="text-muted-foreground block truncate text-[10px]">
            {booking.typeName}
          </span>
        )}
        {gapped && !cancelled && (
          <span
            className="text-warning absolute top-1 right-1 text-xs"
            title={coverageTitle(booking.coverage_status)}
            aria-label={coverageTitle(booking.coverage_status)}
          >
            ⚠
          </span>
        )}
        {/* Resurface bookings (and only those) carry a lifecycle status; a
            resolved one gets a glyph so the block answers "did the cut
            happen" without opening the sheet. */}
        {booking.resurface_status && booking.resurface_status !== "scheduled" && !cancelled && (
          <span
            className="text-muted-foreground absolute right-1 bottom-1 text-xs"
            title={resurfaceTitle(booking.resurface_status)}
            aria-label={resurfaceTitle(booking.resurface_status)}
          >
            {booking.resurface_status === "completed" ? "✓" : "∅"}
          </span>
        )}
      </button>

      {/* The resurfacing buffer, so the true bookable gap is visible. */}
      {geo.bufferPct > 0 && !cancelled && (
        <div
          aria-hidden
          title={`${booking.buffer_minutes_after} min resurfacing buffer`}
          className="pointer-events-none absolute inset-x-1 rounded-b-md border-x border-b opacity-70"
          style={{
            top: `${geo.topPct + geo.heightPct}%`,
            height: `${geo.bufferPct}%`,
            borderColor: booking.typeColor,
            backgroundImage:
              "repeating-linear-gradient(45deg, color-mix(in oklab, currentColor 12%, transparent) 0 4px, transparent 4px 8px)",
          }}
        />
      )}
    </>
  )
}

function coverageTitle(status: string): string {
  switch (status) {
    case "gap_hours":
      return "Outside the facility's operating hours"
    case "gap_staffing":
      return "No published shift covers this booking"
    case "gap_both":
      return "Outside operating hours, and no published shift covers it"
    default:
      return "Coverage gap"
  }
}

function resurfaceTitle(status: string): string {
  switch (status) {
    case "completed":
      return "Resurface completed"
    case "skipped":
      return "Resurface skipped"
    default:
      return "Resurface scheduled"
  }
}

function StatusChips({ booking }: { booking: BookingView }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {booking.resurface_status && (
        <Badge variant="outline" className="uppercase" title={resurfaceTitle(booking.resurface_status)}>
          {booking.resurface_status === "scheduled"
            ? "resurface"
            : booking.resurface_status === "completed"
              ? "resurfaced"
              : "skipped"}
        </Badge>
      )}
      {booking.status === "tentative" && (
        <Badge variant="outline" className="uppercase">
          tentative
        </Badge>
      )}
      {booking.status === "cancelled" && (
        <Badge variant="secondary" className="uppercase">
          cancelled
        </Badge>
      )}
      {booking.coverage_status !== "covered" && booking.status !== "cancelled" && (
        <Badge variant="secondary" title={coverageTitle(booking.coverage_status)}>
          ⚠
        </Badge>
      )}
    </span>
  )
}


// ---------------------------------------------------------------------------
// Offline read-cache
//
// Viewing the calendar online is what populates the offline copy — there is no
// separate sync step. Writes are NOT cached: booking conflicts are enforced by
// a database exclusion constraint that re-checks at insert time, so a booking
// queued offline could be accepted against a world that has since moved on.
// Best-effort throughout; a storage failure must never break the calendar.
// ---------------------------------------------------------------------------

function useCalendarCacheWriter({
  bookings,
  rinks,
  timeZone,
}: {
  bookings: BookingView[]
  rinks: RinkRow[]
  timeZone: string | null
}) {
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const supabase = createClient()
        const { data } = await supabase.auth.getSession()
        const userId = data.session?.user?.id
        const facilityId = bookings[0]?.facility_id ?? rinks[0]?.facility_id
        if (!userId || !facilityId || cancelled) return

        const rows: CachedBooking[] = bookings.map((b) => ({
          id: b.id,
          rinkId: b.rink_id,
          rinkName: b.rinkName,
          rinkShortCode: b.rinkShortCode,
          typeName: b.typeName,
          typeColor: b.typeColor,
          customerName: b.customerName,
          title: b.title,
          startsAt: b.starts_at,
          endsAt: b.ends_at,
          bufferMinutesAfter: b.buffer_minutes_after ?? 0,
          status: b.status,
          coverageStatus: b.coverage_status,
        }))

        await putCalendar({
          userId,
          facilityId,
          timeZone,
          cachedAt: new Date().toISOString(),
          rinks: rinks.map((r) => ({
            id: r.id,
            name: r.name,
            shortCode: r.short_code,
            color: r.display_color,
          })),
          bookings: bookingsInWindow(rows, Date.now()),
        })
      } catch {
        // Best-effort caching.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [bookings, rinks, timeZone])
}
