"use client"

import { useMemo, useRef, useState } from "react"

import { cn } from "@/lib/utils"

import type { EmployeeLite } from "../../_lib/types"
import {
  blockRect,
  buildCoverageGrid,
  clampHour,
  dateToDecimalHour,
  fmtHour,
  yToHour,
} from "../_lib/grid-geometry"
import {
  initialsFor,
  shiftColor,
  type ColorBy,
  type GridEvent,
} from "../_lib/board-model"

const GUTTER = 64
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
const MIN_HOURS = 0.25

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function dateFromDayHour(day: Date, h: number): Date {
  const d = new Date(day)
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  d.setHours(hh, mm, 0, 0)
  return d
}

type Drag =
  | { kind: "create"; day: number; startH: number; curH: number }
  | {
      kind: "move"
      id: string
      grabH: number
      duration: number
      day: number
      origDay: number
      curS: number
      moved: boolean
    }
  | {
      kind: "resize"
      id: string
      edge: "top" | "bottom"
      day: number
      curH: number
      otherH: number
    }

export type WeekGridProps = {
  events: GridEvent[]
  employees: EmployeeLite[]
  jobAreaOrder: Map<string, number>
  days: Date[]
  todayIndex: number
  hourStart: number
  hourEnd: number
  rowH: number
  colorBy: ColorBy
  heatmap: boolean
  nowHour: number | null
  selectedId: string | null
  swapShiftIds: Set<string>
  density: "compact" | "comfortable" | "spacious"
  onSelect: (id: string) => void
  onCreate: (start: Date, end: Date) => void
  onCommitTimes: (id: string, start: Date, end: Date) => void
}

export function WeekGrid(props: WeekGridProps) {
  const {
    events,
    employees,
    jobAreaOrder,
    days,
    todayIndex,
    hourStart,
    hourEnd,
    rowH,
    colorBy,
    heatmap,
    nowHour,
    selectedId,
    swapShiftIds,
    density,
    onSelect,
    onCreate,
    onCommitTimes,
  } = props

  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  const empById = useMemo(
    () => new Map(employees.map((e) => [e.id, e])),
    [employees],
  )

  const hourCount = hourEnd - hourStart + 1
  const hours = useMemo(
    () => Array.from({ length: hourCount }, (_, i) => hourStart + i),
    [hourCount, hourStart],
  )

  // Per-event day index within the visible columns (null = not shown).
  const placed = useMemo(() => {
    return events
      .map((ev) => {
        const dayIndex = days.findIndex((d) => sameLocalDay(d, ev.start))
        if (dayIndex < 0) return null
        return {
          ev,
          dayIndex,
          s: dateToDecimalHour(ev.start),
          e: dateToDecimalHour(ev.end),
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
  }, [events, days])

  const coverage = useMemo(
    () =>
      heatmap
        ? buildCoverageGrid(
            placed.map((p) => ({ day: p.dayIndex, s: p.s, e: p.e })),
            hourStart,
            hourCount,
          )
        : null,
    [heatmap, placed, hourStart, hourCount],
  )

  // ---- Pointer geometry ----
  function pointToDayHour(clientX: number, clientY: number) {
    const el = bodyRef.current
    if (!el) return { day: 0, hour: hourStart }
    const rect = el.getBoundingClientRect()
    const colW = (rect.width - GUTTER) / days.length
    const rawDay = Math.floor((clientX - rect.left - GUTTER) / colW)
    const day = Math.min(days.length - 1, Math.max(0, rawDay))
    const hour = yToHour(clientY - rect.top, hourStart, hourEnd, rowH)
    return { day, hour }
  }

  function startCapture(pointerId: number) {
    bodyRef.current?.setPointerCapture?.(pointerId)
  }

  function onColumnPointerDown(e: React.PointerEvent, dayIndex: number) {
    if (e.button !== 0) return
    const { hour } = pointToDayHour(e.clientX, e.clientY)
    startCapture(e.pointerId)
    setDrag({ kind: "create", day: dayIndex, startH: hour, curH: hour })
  }

  function onBlockPointerDown(
    e: React.PointerEvent,
    p: { ev: GridEvent; dayIndex: number; s: number; e: number },
  ) {
    if (e.button !== 0) return
    e.stopPropagation()
    const { hour, day } = pointToDayHour(e.clientX, e.clientY)
    startCapture(e.pointerId)
    setDrag({
      kind: "move",
      id: p.ev.id,
      grabH: hour - p.s,
      duration: p.e - p.s,
      day,
      origDay: p.dayIndex,
      curS: p.s,
      moved: false,
    })
  }

  function onResizePointerDown(
    e: React.PointerEvent,
    p: { ev: GridEvent; dayIndex: number; s: number; e: number },
    edge: "top" | "bottom",
  ) {
    if (e.button !== 0) return
    e.stopPropagation()
    startCapture(e.pointerId)
    setDrag({
      kind: "resize",
      id: p.ev.id,
      edge,
      day: p.dayIndex,
      curH: edge === "top" ? p.s : p.e,
      otherH: edge === "top" ? p.e : p.s,
    })
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return
    const { day, hour } = pointToDayHour(e.clientX, e.clientY)
    if (drag.kind === "create") {
      setDrag({ ...drag, curH: hour })
    } else if (drag.kind === "move") {
      const curS = clampHour(
        hour - drag.grabH,
        hourStart,
        hourEnd - drag.duration,
      )
      const moved =
        drag.moved || day !== drag.origDay || Math.abs(curS - drag.curS) > 0.01
      setDrag({ ...drag, day, curS, moved })
    } else {
      setDrag({ ...drag, curH: hour })
    }
  }

  function onPointerUp() {
    if (!drag) return
    const current = drag
    setDrag(null)

    if (current.kind === "create") {
      const lo = Math.min(current.startH, current.curH)
      let hi = Math.max(current.startH, current.curH)
      if (hi - lo < MIN_HOURS) hi = Math.min(hourEnd, lo + 1)
      const dayDate = days[current.day]
      onCreate(dateFromDayHour(dayDate, lo), dateFromDayHour(dayDate, hi))
      return
    }

    if (current.kind === "move") {
      if (!current.moved) {
        onSelect(current.id)
        return
      }
      const dayDate = days[current.day]
      const start = dateFromDayHour(dayDate, current.curS)
      const end = dateFromDayHour(dayDate, current.curS + current.duration)
      onCommitTimes(current.id, start, end)
      return
    }

    // resize
    const dayDate = days[current.day]
    let s: number
    let e: number
    if (current.edge === "top") {
      s = Math.min(current.curH, current.otherH - MIN_HOURS)
      e = current.otherH
    } else {
      s = current.otherH
      e = Math.max(current.curH, current.otherH + MIN_HOURS)
    }
    onCommitTimes(current.id, dateFromDayHour(dayDate, s), dateFromDayHour(dayDate, e))
  }

  // Resolve a block's display geometry, applying any in-flight drag preview.
  function previewFor(p: {
    ev: GridEvent
    dayIndex: number
    s: number
    e: number
  }): { dayIndex: number; s: number; e: number } {
    if (!drag) return p
    if (drag.kind === "move" && drag.id === p.ev.id) {
      return { dayIndex: drag.day, s: drag.curS, e: drag.curS + drag.duration }
    }
    if (drag.kind === "resize" && drag.id === p.ev.id) {
      if (drag.edge === "top") {
        return {
          dayIndex: p.dayIndex,
          s: Math.min(drag.curH, drag.otherH - MIN_HOURS),
          e: drag.otherH,
        }
      }
      return {
        dayIndex: p.dayIndex,
        s: drag.otherH,
        e: Math.max(drag.curH, drag.otherH + MIN_HOURS),
      }
    }
    return p
  }

  const bodyHeight = hourCount * rowH

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-elev-1)]">
      {/* Day header */}
      <div
        className="sticky top-0 z-[5] grid border-b border-border bg-card"
        style={{ gridTemplateColumns: `${GUTTER}px repeat(${days.length}, 1fr)` }}
      >
        <div />
        {days.map((d, i) => {
          const isToday = i === todayIndex
          const count = placed.filter((p) => p.dayIndex === i).length
          return (
            <div
              key={d.toISOString()}
              className={cn(
                "flex h-16 items-center gap-2 border-l border-border px-3",
                isToday && "bg-primary/10",
              )}
            >
              <div className="flex flex-col">
                <span
                  className={cn(
                    "text-[10px] font-bold tracking-[0.12em]",
                    isToday ? "text-success-soft-foreground" : "text-muted-foreground",
                  )}
                >
                  {DOW[d.getDay()]}
                </span>
                <span className="font-display text-[28px] leading-none text-foreground">
                  {d.getDate()}
                </span>
              </div>
              <div className="ml-auto text-right">
                <div className="text-[10px] font-semibold tracking-wide text-muted-foreground">
                  SHIFTS
                </div>
                <div className="font-mono text-base font-semibold tabular-nums text-foreground">
                  {count}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Body */}
      <div
        ref={bodyRef}
        className="relative grid touch-none select-none"
        style={{
          gridTemplateColumns: `${GUTTER}px repeat(${days.length}, 1fr)`,
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Hour gutter */}
        <div className="bg-secondary/60" style={{ height: bodyHeight }}>
          {hours.map((h) => (
            <div
              key={h}
              className="border-b border-border/40 px-2.5 text-right font-mono text-[10.5px] text-muted-foreground"
              style={{ height: rowH, lineHeight: `${rowH}px` }}
            >
              {fmtHour(h)}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {days.map((d, di) => {
          const isToday = di === todayIndex
          return (
            <div
              key={d.toISOString()}
              className={cn(
                "relative border-l border-border",
                isToday && "bg-primary/[0.03]",
              )}
              style={{ height: bodyHeight }}
              onPointerDown={(e) => onColumnPointerDown(e, di)}
            >
              {hours.map((h, hi) => {
                let bg: string | undefined
                if (coverage) {
                  const c = coverage[di][hi]
                  if (c > 0) {
                    bg = `color-mix(in oklab, var(--primary) ${Math.min(22, c * 6)}%, transparent)`
                  } else if (h >= 7 && h < 21) {
                    bg = "color-mix(in oklab, var(--destructive) 7%, transparent)"
                  }
                }
                return (
                  <div
                    key={h}
                    className="border-b border-border/40"
                    style={{ height: rowH, background: bg }}
                  />
                )
              })}

              {/* Create preview */}
              {drag?.kind === "create" && drag.day === di ? (
                (() => {
                  const lo = Math.min(drag.startH, drag.curH)
                  const hi = Math.max(drag.startH, drag.curH)
                  const { top, height } = blockRect(lo, Math.max(hi, lo + MIN_HOURS), hourStart, rowH)
                  return (
                    <div
                      className="pointer-events-none absolute inset-x-1 rounded-lg border-2 border-dashed border-primary bg-primary/10"
                      style={{ top, height }}
                    />
                  )
                })()
              ) : null}

              {/* Now line */}
              {isToday && nowHour != null && nowHour >= hourStart && nowHour <= hourEnd ? (
                <div
                  className="pointer-events-none absolute inset-x-0 z-[3] h-0.5 bg-destructive"
                  style={{ top: (nowHour - hourStart) * rowH }}
                >
                  <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-destructive" />
                </div>
              ) : null}
            </div>
          )
        })}

        {/* Shift blocks — absolute overlay inside the body (excludes header). */}
        {placed.map((p) => {
          const view = previewFor(p)
          const s = clampHour(view.s, hourStart, hourEnd)
          const e = clampHour(view.e, hourStart, hourEnd + 1)
          const { top, height } = blockRect(s, e, hourStart, rowH)
          const col = shiftColor(p.ev, colorBy, jobAreaOrder)
          const emp = p.ev.employeeId ? empById.get(p.ev.employeeId) : null
          const isSel = selectedId === p.ev.id
          const isDragging =
            (drag?.kind === "move" || drag?.kind === "resize") && drag.id === p.ev.id
          const frac = view.dayIndex / days.length
          const widthFrac = 1 / days.length
          const showTime = height >= 32
          const showRole = height >= 52

          return (
            <div
              key={p.ev.id}
              onPointerDown={(ev) => onBlockPointerDown(ev, p)}
              className={cn(
                "absolute overflow-hidden rounded-lg",
                isDragging ? "z-[6] cursor-grabbing" : "z-[2] cursor-grab",
              )}
              style={{
                left: `calc(${GUTTER}px + (100% - ${GUTTER}px) * ${frac} + 4px)`,
                width: `calc((100% - ${GUTTER}px) * ${widthFrac} - 8px)`,
                top,
                height,
                background: col.bg,
                border: `1px solid ${col.border}`,
                borderLeft: `3px solid ${col.edge}`,
                padding: density === "compact" ? "3px 5px" : "5px 7px",
                boxShadow: isSel
                  ? "0 0 0 2px var(--primary), 0 6px 14px rgba(0,0,0,.14)"
                  : isDragging
                    ? "0 8px 18px rgba(0,0,0,.18)"
                    : undefined,
              }}
            >
              {/* Top resize handle */}
              <div
                onPointerDown={(ev) => onResizePointerDown(ev, p, "top")}
                className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize"
              />
              <div className="flex items-center gap-1.5 leading-tight">
                <span
                  className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[9px] font-extrabold text-white"
                  style={{ background: col.edge }}
                >
                  {initialsFor(emp)}
                </span>
                <span className="min-w-0 truncate text-[11.5px] font-bold text-foreground">
                  {emp ? emp.first_name : "Open"}
                  {swapShiftIds.has(p.ev.id) ? (
                    <span className="ml-1.5 rounded-full bg-warning px-1.5 py-px text-[8.5px] font-extrabold tracking-wide text-warning-foreground">
                      SWAP
                    </span>
                  ) : null}
                </span>
              </div>
              {showTime ? (
                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {fmtHour(s)}–{fmtHour(e)}
                </div>
              ) : null}
              {showRole && p.ev.roleLabel ? (
                <div className="mt-0.5 truncate text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {p.ev.roleLabel}
                </div>
              ) : null}
              {/* Bottom resize handle */}
              <div
                onPointerDown={(ev) => onResizePointerDown(ev, p, "bottom")}
                className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
