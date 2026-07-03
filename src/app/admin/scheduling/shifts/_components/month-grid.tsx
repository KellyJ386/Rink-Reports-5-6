"use client"

import { useCallback, useMemo, useState } from "react"

import { cn } from "@/lib/utils"

import type { EmployeeLite } from "../../_lib/types"
import {
  initialsFor,
  monthGridRange,
  shiftColor,
  type ColorBy,
  type GridEvent,
} from "../_lib/board-model"

// Read-only month calendar of draft/published shifts. It reuses the board's
// in-memory `events` (already preloaded by the page in a ±42-day window around
// the anchor, which covers the displayed month grid) — no new data layer, and
// no editing: the day/week views remain the editing surfaces. Dates are read in
// the browser's local zone, mirroring the day/week grid exactly.

const MAX_CHIPS_PER_DAY = 3
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function startOfDay(d: Date): Date {
  const next = new Date(d)
  next.setHours(0, 0, 0, 0)
  return next
}

function addDays(d: Date, days: number): Date {
  const next = startOfDay(d)
  next.setDate(next.getDate() + days)
  return next
}

function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function fmtTime(d: Date): string {
  return d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .replace(":00", "")
    .toLowerCase()
}

export type MonthGridProps = {
  events: GridEvent[]
  employees: EmployeeLite[]
  jobAreaOrder: Map<string, number>
  jobAreaNameById: Map<string, string>
  /** Any date inside the month to display; the grid spans whole weeks. */
  anchor: Date
  /** 0 = Sunday … 6 = Saturday (schedule_settings.week_start_day). */
  weekStartDay: number
  colorBy: ColorBy
  /** Click a day to jump the day/week views to that date. */
  onSelectDay: (day: Date) => void
}

export function MonthGrid({
  events,
  employees,
  jobAreaOrder,
  jobAreaNameById,
  anchor,
  weekStartDay,
  colorBy,
  onSelectDay,
}: MonthGridProps) {
  const empById = useMemo(
    () => new Map(employees.map((e) => [e.id, e])),
    [employees],
  )

  // Whole-week grid from the week containing the 1st to the week containing
  // the last day of the anchor's month (4–6 rows). Shared with the board's
  // KPI/export window so month-view numbers match what this grid displays.
  const gridDays = useMemo(() => {
    const { start, dayCount } = monthGridRange(anchor, weekStartDay)
    return Array.from({ length: dayCount }, (_, i) => addDays(start, i))
  }, [anchor, weekStartDay])

  // Bucket events by local day key, sorted by start time within each day.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, GridEvent[]>()
    for (const ev of events) {
      const key = dayKey(ev.start)
      const list = map.get(key)
      if (list) list.push(ev)
      else map.set(key, [ev])
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.start.getTime() - b.start.getTime())
    }
    return map
  }, [events])

  const orderedWeekdays = useMemo(() => {
    const wsd = ((weekStartDay % 7) + 7) % 7
    return Array.from({ length: 7 }, (_, i) => WEEKDAY_LABELS[(wsd + i) % 7])
  }, [weekStartDay])

  const today = useMemo(() => new Date(), [])
  const month = anchor.getMonth()

  // Per-day expand view-state: which day cells reveal their full shift stack
  // instead of the capped preview. Pure view-state — never touches shift data.
  const [expandedDays, setExpandedDays] = useState<Set<string>>(
    () => new Set(),
  )
  const toggleDay = useCallback((key: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="grid grid-cols-7 border-b border-border bg-muted/40">
        {orderedWeekdays.map((label) => (
          <div
            key={label}
            className="px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wide text-muted-foreground"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {gridDays.map((day) => {
          const inMonth = day.getMonth() === month
          const isToday = sameDay(day, today)
          const key = dayKey(day)
          const dayEvents = eventsByDay.get(key) ?? []
          const isExpanded = expandedDays.has(key)
          const visible =
            isExpanded || dayEvents.length <= MAX_CHIPS_PER_DAY
              ? dayEvents
              : dayEvents.slice(0, MAX_CHIPS_PER_DAY)
          const overflow = dayEvents.length - visible.length
          const dayLabel = day.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })
          return (
            // Day cell navigates to the week view; a div (not a button) so the
            // expand control below can be a real nested button. Keyboard-
            // accessible via role/tabIndex + Enter/Space.
            <div
              key={key}
              role="button"
              tabIndex={0}
              aria-label={`Open ${dayLabel} in week view`}
              onClick={() => onSelectDay(day)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  onSelectDay(day)
                }
              }}
              className={cn(
                "flex min-h-[7rem] flex-col gap-1 border-b border-r border-border/70 p-1.5 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                !inMonth && "bg-muted/30 text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "ml-auto grid h-6 w-6 place-items-center rounded-full text-xs font-semibold",
                  isToday
                    ? "bg-primary text-primary-foreground"
                    : inMonth
                      ? "text-foreground"
                      : "text-muted-foreground",
                )}
              >
                {day.getDate()}
              </span>
              <div className="flex flex-col gap-0.5">
                {visible.map((ev) => {
                  const color = shiftColor(ev, colorBy, jobAreaOrder)
                  const emp = ev.employeeId ? empById.get(ev.employeeId) : null
                  const who = emp
                    ? `${initialsFor(emp)} ${emp.last_name}`
                    : ev.jobAreaId
                      ? (jobAreaNameById.get(ev.jobAreaId) ?? "Open")
                      : "Open"
                  return (
                    <span
                      key={ev.id}
                      title={`${fmtTime(ev.start)}–${fmtTime(ev.end)} · ${who}`}
                      className="flex items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-[11px] leading-tight"
                      style={{
                        backgroundColor: color.bg,
                        borderColor: color.border,
                      }}
                    >
                      <span
                        aria-hidden
                        className="h-2.5 w-1 shrink-0 rounded-full"
                        style={{ backgroundColor: color.edge }}
                      />
                      <span className="font-medium text-foreground">
                        {fmtTime(ev.start)}
                      </span>
                      <span className="truncate text-muted-foreground">
                        {who}
                      </span>
                    </span>
                  )
                })}
                {dayEvents.length > MAX_CHIPS_PER_DAY ? (
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-label={
                      isExpanded
                        ? `Collapse ${dayLabel}`
                        : `Show all ${dayEvents.length} shifts on ${dayLabel}`
                    }
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleDay(key)
                    }}
                    className="rounded-md px-1 py-0.5 text-left text-[11px] font-semibold text-foreground-strong underline-offset-2 transition-colors hover:bg-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {isExpanded ? "Show less" : `+${overflow} more`}
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
