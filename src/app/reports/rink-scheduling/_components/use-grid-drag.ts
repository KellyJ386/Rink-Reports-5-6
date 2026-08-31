"use client"

// Drag interactions for the booking grids: move a block, resize its end,
// or drag out a new slot. One hook instance per grid (the day view's
// columns are rinks; the week view's are days) — the grid tells the hook
// which column is which via registerColumn, and gets back everything it
// needs to render ghosts and wire handlers.
//
// Interaction contract:
//   - mouse/pen: a drag begins once the pointer moves ~5px; less is a click
//     and falls through to the normal click handlers.
//   - touch: a 350ms hold lifts the block (so the page still scrolls
//     normally); moving before the hold completes cancels it.
//   - all math is pure (drag-model.ts); the DB exclusion constraint stays
//     the only overlap authority — a colliding drop is refused server-side
//     and rolled back by the caller.

import { useCallback, useEffect, useRef, useState } from "react"

import {
  applyMove,
  applyResize,
  dragCreateRange,
  passesDragThreshold,
  pixelsToMinutes,
  snapMinute,
  type GridExtent,
} from "../_lib/drag-model"
import type { BookingView } from "../_lib/types"

const TOUCH_HOLD_MS = 350

export type DragGhost = {
  bookingId: string | null // null = drag-create selection
  colKey: string
  startMinute: number
  endMinute: number
  mode: "move" | "resize" | "create"
}

export type DragCommit = {
  mode: "move" | "resize"
  booking: BookingView
  colKey: string
  startMinute: number
  endMinute: number
}

export type CreateCommit = {
  colKey: string
  startMinute: number
  endMinute: number
}

type Active =
  | {
      phase: "maybe" | "dragging"
      mode: "move" | "resize"
      booking: BookingView
      originCol: string
      originStart: number
      originEnd: number
      startX: number
      startY: number
      pointerId: number
    }
  | {
      phase: "maybe" | "dragging"
      mode: "create"
      booking: null
      originCol: string
      anchorMinute: number
      startX: number
      startY: number
      pointerId: number
    }

export function useGridDrag({
  extent,
  slotMinutes,
  enabled,
  onCommit,
  onCreate,
}: {
  extent: GridExtent
  slotMinutes: number
  enabled: boolean
  onCommit: (commit: DragCommit) => void
  onCreate: (commit: CreateCommit) => void
}) {
  const [ghost, setGhost] = useState<DragGhost | null>(null)
  const activeRef = useRef<Active | null>(null)
  const ghostRef = useRef<DragGhost | null>(null)
  const columnsRef = useRef(new Map<string, HTMLElement>())
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const registerColumn = useCallback((colKey: string) => {
    return (el: HTMLElement | null) => {
      if (el) columnsRef.current.set(colKey, el)
      else columnsRef.current.delete(colKey)
    }
  }, [])

  const setGhostBoth = (g: DragGhost | null) => {
    ghostRef.current = g
    setGhost(g)
  }

  const clearHold = () => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }

  /** The column under the pointer's X, defaulting to where the drag began. */
  const columnAt = (clientX: number, fallback: string): string => {
    for (const [key, el] of columnsRef.current) {
      const r = el.getBoundingClientRect()
      if (clientX >= r.left && clientX < r.right) return key
    }
    return fallback
  }

  const gridHeight = (colKey: string): number =>
    columnsRef.current.get(colKey)?.getBoundingClientRect().height ?? 0

  const minuteAtY = (clientY: number, colKey: string): number => {
    const el = columnsRef.current.get(colKey)
    if (!el) return extent.startMinute
    const r = el.getBoundingClientRect()
    return extent.startMinute + pixelsToMinutes(clientY - r.top, r.height, extent)
  }

  /** Keep a dragged range on the rendered grid — you can't aim at a minute
   *  you can't see, so the extent (not the raw day) is the drag's boundary. */
  const clampMoveToExtent = (range: { startMinute: number; endMinute: number }) => {
    const duration = range.endMinute - range.startMinute
    const start = Math.max(
      extent.startMinute,
      Math.min(extent.endMinute - duration, range.startMinute),
    )
    return { startMinute: start, endMinute: start + duration }
  }

  /** The click that follows a completed drag would open the booking sheet on
   *  whatever the pointer was released over; swallow exactly that one. */
  const suppressNextClick = () => {
    const swallow = (ev: MouseEvent) => {
      ev.stopPropagation()
      ev.preventDefault()
      cleanup()
    }
    const timer = setTimeout(() => cleanup(), 300)
    const cleanup = () => {
      window.removeEventListener("click", swallow, true)
      clearTimeout(timer)
    }
    window.addEventListener("click", swallow, true)
  }

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const active = activeRef.current
      if (!active || e.pointerId !== active.pointerId) return

      if (active.phase === "maybe") {
        if (!passesDragThreshold(e.clientX - active.startX, e.clientY - active.startY)) return
        active.phase = "dragging"
        document.body.style.userSelect = "none"
      }
      e.preventDefault()

      if (active.mode === "create") {
        const col = active.originCol // creating never changes column mid-drag
        const pointerMinute = minuteAtY(e.clientY, col)
        const range = dragCreateRange(active.anchorMinute, pointerMinute, slotMinutes, extent)
        setGhostBoth({ bookingId: null, colKey: col, ...range, mode: "create" })
        return
      }

      const deltaMin = pixelsToMinutes(
        e.clientY - active.startY,
        gridHeight(active.originCol),
        extent,
      )
      if (active.mode === "move") {
        const col = columnAt(e.clientX, active.originCol)
        const next = clampMoveToExtent(
          applyMove(active.originStart, active.originEnd, deltaMin, slotMinutes),
        )
        setGhostBoth({
          bookingId: active.booking.id,
          colKey: col,
          ...next,
          mode: "move",
        })
      } else {
        const next = applyResize(active.originStart, active.originEnd, deltaMin, slotMinutes)
        next.endMinute = Math.min(extent.endMinute, next.endMinute)
        setGhostBoth({
          bookingId: active.booking.id,
          colKey: active.originCol,
          ...next,
          mode: "resize",
        })
      }
    }

    function onUp(e: PointerEvent) {
      const active = activeRef.current
      if (!active || e.pointerId !== active.pointerId) return
      clearHold()
      const g = ghostRef.current
      const wasDragging = active.phase === "dragging"
      activeRef.current = null
      document.body.style.userSelect = ""
      setGhostBoth(null)

      if (!wasDragging || !g) return // a plain click; normal handlers ran
      e.preventDefault()
      suppressNextClick()

      if (active.mode === "create") {
        onCreate({ colKey: g.colKey, startMinute: g.startMinute, endMinute: g.endMinute })
        return
      }
      // No-op drop: back where it started.
      if (
        g.colKey === active.originCol &&
        g.startMinute === active.originStart &&
        g.endMinute === active.originEnd
      ) {
        return
      }
      onCommit({
        mode: active.mode,
        booking: active.booking,
        colKey: g.colKey,
        startMinute: g.startMinute,
        endMinute: g.endMinute,
      })
    }

    function onCancel(e: PointerEvent) {
      const active = activeRef.current
      if (!active || e.pointerId !== active.pointerId) return
      clearHold()
      activeRef.current = null
      document.body.style.userSelect = ""
      setGhostBoth(null)
    }

    // preventDefault on pointermove does NOT stop touch scrolling — only a
    // non-passive touchmove listener can, once a touch drag is in flight.
    function onTouchMove(e: TouchEvent) {
      const active = activeRef.current
      if (active?.phase === "dragging") e.preventDefault()
    }

    window.addEventListener("pointermove", onMove, { passive: false })
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onCancel)
    window.addEventListener("touchmove", onTouchMove, { passive: false })
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onCancel)
      window.removeEventListener("touchmove", onTouchMove)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extent.startMinute, extent.endMinute, slotMinutes, onCommit, onCreate])

  /** pointerdown handler for a block body (move) or its resize handle. */
  const startBlockDrag = useCallback(
    (
      e: React.PointerEvent,
      booking: BookingView,
      colKey: string,
      startMinute: number,
      endMinute: number,
      mode: "move" | "resize",
    ) => {
      if (!enabled || e.button !== 0) return
      const begin = (phase: "maybe" | "dragging") => {
        activeRef.current = {
          phase,
          mode,
          booking,
          originCol: colKey,
          originStart: startMinute,
          originEnd: endMinute,
          startX: e.clientX,
          startY: e.clientY,
          pointerId: e.pointerId,
        }
        if (phase === "dragging") {
          document.body.style.userSelect = "none"
          setGhostBoth({ bookingId: booking.id, colKey, startMinute, endMinute, mode })
        }
      }
      if (e.pointerType === "touch") {
        // Hold to lift; a scroll before the hold completes fires pointercancel
        // (the browser reclaims the gesture), which must also kill the timer —
        // otherwise the hold fires mid-scroll and strands a ghost with no
        // pointer left to finish it.
        clearHold()
        holdTimerRef.current = setTimeout(() => begin("dragging"), TOUCH_HOLD_MS)
        activeRef.current = null
        const pid = e.pointerId
        const cancelHoldOnEnd = (ev: PointerEvent) => {
          if (ev.pointerId !== pid) return
          clearHold()
          window.removeEventListener("pointerup", cancelHoldOnEnd)
          window.removeEventListener("pointercancel", cancelHoldOnEnd)
        }
        window.addEventListener("pointerup", cancelHoldOnEnd)
        window.addEventListener("pointercancel", cancelHoldOnEnd)
        return
      }
      begin("maybe")
    },
    [enabled],
  )

  /** pointerdown handler for an empty slot (drag-create). */
  const startCreateDrag = useCallback(
    (e: React.PointerEvent, colKey: string, anchorMinute: number) => {
      if (!enabled || e.button !== 0) return
      if (e.pointerType === "touch") return // touch keeps tap-to-create only
      activeRef.current = {
        phase: "maybe",
        mode: "create",
        booking: null,
        originCol: colKey,
        anchorMinute,
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.pointerId,
      }
    },
    [enabled],
  )

  /** True while a drag is in flight — click handlers should bail. */
  const isDragging = ghost !== null

  return { ghost, isDragging, registerColumn, startBlockDrag, startCreateDrag, snap: (m: number) => snapMinute(m, slotMinutes) }
}
