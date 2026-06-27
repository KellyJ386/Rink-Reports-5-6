"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import {
  DndContext,
  KeyboardSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"

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
  applyGridDelta,
  isRealMove,
  pixelDeltaToGridDelta,
} from "../_lib/keyboard-move"
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

  // ---- Keyboard drag-and-drop (@dnd-kit) state ----
  // The pointer drag above is mouse/touch only and has no keyboard path. We
  // layer @dnd-kit's KeyboardSensor on top so a block can be picked up with
  // Space/Enter and moved with the arrow keys. Only the KeyboardSensor is
  // registered, so @dnd-kit never intercepts pointer events — the two systems
  // coexist without conflict.
  const [kbActiveId, setKbActiveId] = useState<string | null>(null)
  // Per-arrow-press pixel step + clamp window, measured from the live grid on
  // pickup so the coordinate getter snaps one day column / one hour row.
  const geomRef = useRef<{
    colWidth: number
    rowH: number
    left: number
    top: number
    right: number
    bottom: number
  } | null>(null)

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
    // Published shifts are publish-locked: no casual drag-move on the grid. A
    // pointer-down just selects, so the deliberate, governed republish edit
    // (the popover, which warns it re-notifies staff) stays the only way to
    // change them. The server + DB enforce the lock regardless of this guard.
    if (p.ev.status === "published") {
      onSelect(p.ev.id)
      return
    }
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

  // ---- Keyboard drag-and-drop (@dnd-kit) ----
  // Measure one column / one row in pixels and the body's clamp window at the
  // moment a block is picked up, so the arrow-key coordinate getter snaps
  // cleanly and the dragged block can't be flung off the grid.
  const measureGeom = useCallback(() => {
    const el = bodyRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const colWidth = (rect.width - GUTTER) / Math.max(1, days.length)
    geomRef.current = {
      colWidth,
      rowH,
      left: rect.left + GUTTER,
      top: rect.top,
      right: rect.right - colWidth,
      bottom: rect.bottom - rowH,
    }
  }, [days.length, rowH])

  // Each arrow press translates the picked-up block by exactly one day column
  // (←/→) or one hour row (↑/↓), clamped to the grid body.
  const coordinateGetter: KeyboardCoordinateGetter = useCallback(
    (event, { currentCoordinates }) => {
      const g = geomRef.current
      if (!g) return undefined
      let { x, y } = currentCoordinates
      switch (event.code) {
        case "ArrowRight":
          x += g.colWidth
          break
        case "ArrowLeft":
          x -= g.colWidth
          break
        case "ArrowDown":
          y += g.rowH
          break
        case "ArrowUp":
          y -= g.rowH
          break
        default:
          return undefined
      }
      event.preventDefault()
      return {
        x: Math.min(g.right, Math.max(g.left, x)),
        y: Math.min(g.bottom, Math.max(g.top, y)),
      }
    },
    [],
  )

  const sensors = useSensors(useSensor(KeyboardSensor, { coordinateGetter }))

  const onKbDragStart = useCallback(
    (e: DragStartEvent) => {
      measureGeom()
      setKbActiveId(String(e.active.id))
    },
    [measureGeom],
  )

  const onKbDragEnd = useCallback(
    (e: DragEndEvent) => {
      const id = String(e.active.id)
      setKbActiveId(null)
      const g = geomRef.current
      const p = placed.find((x) => x.ev.id === id)
      if (!g || !p) return
      // Keyboard steps are whole hours (one row) — snap vertical to 1h.
      const gd = pixelDeltaToGridDelta(
        { x: e.delta.x, y: e.delta.y },
        { colWidth: g.colWidth, rowH: g.rowH, hourStep: 1 },
      )
      const from = { dayIndex: p.dayIndex, startHour: p.s, endHour: p.e }
      const to = applyGridDelta(from, gd, {
        dayCount: days.length,
        hourStart,
        hourEnd,
      })
      if (!isRealMove(from, to)) return
      const dayDate = days[to.dayIndex]
      onCommitTimes(
        id,
        dateFromDayHour(dayDate, to.startHour),
        dateFromDayHour(dayDate, to.endHour),
      )
    },
    [placed, days, hourStart, hourEnd, onCommitTimes],
  )

  const onKbDragCancel = useCallback(() => {
    setKbActiveId(null)
  }, [])

  // Drop-target highlight (over which day column is the picked-up block now).
  const [overDay, setOverDay] = useState<number | null>(null)
  const onKbDragOver = useCallback((e: DragOverEvent) => {
    const overId = e.over?.id
    if (typeof overId === "string" && overId.startsWith("day:")) {
      setOverDay(Number(overId.slice(4)))
    } else {
      setOverDay(null)
    }
  }, [])
  const handleKbDragEnd = useCallback(
    (e: DragEndEvent) => {
      setOverDay(null)
      onKbDragEnd(e)
    },
    [onKbDragEnd],
  )
  const handleKbDragCancel = useCallback(() => {
    setOverDay(null)
    onKbDragCancel()
  }, [onKbDragCancel])

  // Resolve a block's display geometry, applying any in-flight pointer-drag
  // preview. (Keyboard drag uses the @dnd-kit transform instead.)
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
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onKbDragStart}
        onDragOver={onKbDragOver}
        onDragEnd={handleKbDragEnd}
        onDragCancel={handleKbDragCancel}
      >
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
              <DayColumn
                key={d.toISOString()}
                index={di}
                isToday={isToday}
                height={bodyHeight}
                dropActive={kbActiveId != null && overDay === di}
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
              </DayColumn>
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
            const isPointerDragging =
              (drag?.kind === "move" || drag?.kind === "resize") && drag.id === p.ev.id
            const frac = view.dayIndex / days.length
            const widthFrac = 1 / days.length
            const showTime = height >= 32
            const showRole = height >= 52
            const who = emp ? emp.first_name : "Open"
            const isPublished = p.ev.status === "published"

            return (
              <ShiftBlock
                key={p.ev.id}
                id={p.ev.id}
                pointerDragging={isPointerDragging}
                published={isPublished}
                onActivate={() => onSelect(p.ev.id)}
                ariaLabel={
                  isPublished
                    ? `${who} shift, ${fmtHour(s)} to ${fmtHour(e)}, published and locked. Press Enter to open and republish.`
                    : `${who} shift, ${fmtHour(s)} to ${fmtHour(e)}. Press space to move, arrow keys to reposition.`
                }
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
                    : isPointerDragging
                      ? "0 8px 18px rgba(0,0,0,.18)"
                      : undefined,
                }}
                onPointerDown={(ev) => onBlockPointerDown(ev, p)}
              >
                {/* Top resize handle (publish-locked shifts can't be resized) */}
                {!isPublished ? (
                  <div
                    onPointerDown={(ev) => onResizePointerDown(ev, p, "top")}
                    className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize"
                  />
                ) : null}
                <div className="flex items-center gap-1.5 leading-tight">
                  <span
                    className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[9px] font-extrabold text-white"
                    style={{ background: col.edge }}
                  >
                    {initialsFor(emp)}
                  </span>
                  <span className="min-w-0 truncate text-[11.5px] font-bold text-foreground">
                    {who}
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
                {/* Bottom resize handle (publish-locked shifts can't be resized) */}
                {!isPublished ? (
                  <div
                    onPointerDown={(ev) => onResizePointerDown(ev, p, "bottom")}
                    className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                  />
                ) : null}
              </ShiftBlock>
            )
          })}
        </div>
      </DndContext>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Droppable day column. The keyboard sensor's collision detection resolves the
// picked-up block to the nearest column; `dropActive` paints a neon-lime
// (--primary / brand #4DFF00) drop-target highlight while a block hovers it.
// ---------------------------------------------------------------------------
function DayColumn({
  index,
  isToday,
  height,
  dropActive,
  onPointerDown,
  children,
}: {
  index: number
  isToday: boolean
  height: number
  dropActive: boolean
  onPointerDown: (e: React.PointerEvent) => void
  children: React.ReactNode
}) {
  const { setNodeRef } = useDroppable({ id: `day:${index}` })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "relative border-l border-border",
        isToday && "bg-primary/[0.03]",
      )}
      style={{ height }}
      onPointerDown={onPointerDown}
    >
      {children}
      {dropActive ? (
        <div className="pointer-events-none absolute inset-0 z-[4] rounded-md bg-primary/10 ring-2 ring-inset ring-primary" />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Draggable shift block. Keeps the existing pointer-drag `onPointerDown` for
// mouse/touch and adds @dnd-kit's keyboard handle (Space/Enter to pick up,
// arrows to move). Only the KeyboardSensor is registered on the context, so the
// spread `listeners` add a keydown handler and never an `onPointerDown` — no
// conflict with the mouse path.
// ---------------------------------------------------------------------------
function ShiftBlock({
  id,
  style,
  pointerDragging,
  published,
  ariaLabel,
  onPointerDown,
  onActivate,
  children,
}: {
  id: string
  style: React.CSSProperties
  pointerDragging: boolean
  published: boolean
  ariaLabel: string
  onPointerDown: (e: React.PointerEvent) => void
  onActivate: () => void
  children: React.ReactNode
}) {
  // Published shifts are publish-locked: keyboard drag is disabled (UX guard;
  // the server + DB enforce the real lock). They stay focusable and open the
  // governed republish editor on Enter/Space.
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id,
      disabled: published,
      attributes: {
        roleDescription: published ? "published shift, locked" : "schedule shift",
      },
    })

  const mergedStyle: React.CSSProperties = {
    ...style,
    ...(transform ? { transform: CSS.Translate.toString(transform) } : null),
    ...(isDragging
      ? { zIndex: 7, boxShadow: "0 8px 18px rgba(0,0,0,.22)" }
      : null),
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...(published ? { tabIndex: 0, role: "button" } : listeners)}
      onPointerDown={onPointerDown}
      onKeyDown={
        published
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onActivate()
              }
            }
          : undefined
      }
      aria-label={ariaLabel}
      data-published={published || undefined}
      className={cn(
        "absolute overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
        published
          ? "z-[2] cursor-pointer"
          : isDragging
            ? "cursor-grabbing"
            : pointerDragging
              ? "z-[6] cursor-grabbing"
              : "z-[2] cursor-grab",
      )}
      style={mergedStyle}
    >
      {children}
    </div>
  )
}
