"use client"

// Pinch-zoom / pan state for the perimeter diagram, expressed entirely through
// the SVG viewBox (no CSS transforms, so hit targets, labels, and stroke
// widths scale together). Phone-first constraints:
//
//  - At rest (scale 1) the svg keeps `touch-action: pan-y`, so one-finger
//    vertical drags scroll the page normally over the (tall) diagram.
//  - A two-finger pinch is not a pan-y gesture, so its events stay cancelable;
//    a non-passive native touchmove listener preventDefault()s them and the
//    hook drives the zoom.
//  - While zoomed, `touch-action: none` and one-finger drags pan the view.
//  - A drag/pinch suppresses the click that would otherwise fire on the
//    segment under the finger (see onClickCapture) — taps still select.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from "react"

const MIN_SCALE = 1
const MAX_SCALE = 5
const BUTTON_STEP = 1.6
/** Pointer travel (px) beyond which a gesture is a drag, not a tap. */
const DRAG_SLOP_PX = 6

type ViewState = { scale: number; vx: number; vy: number }

export type DiagramZoom = {
  /** Current viewBox string for the svg. */
  viewBox: string
  scale: number
  /** Raw view window (viewBox origin + scale) for overlay positioning math. */
  view: { vx: number; vy: number; scale: number }
  isZoomed: boolean
  zoomIn: () => void
  zoomOut: () => void
  reset: () => void
  /** Spread onto the svg element. */
  svgProps: {
    ref: (el: SVGSVGElement | null) => void
    style: { touchAction: string }
    onPointerDown: (e: ReactPointerEvent<SVGSVGElement>) => void
    onPointerMove: (e: ReactPointerEvent<SVGSVGElement>) => void
    onPointerUp: (e: ReactPointerEvent<SVGSVGElement>) => void
    onPointerCancel: (e: ReactPointerEvent<SVGSVGElement>) => void
    onClickCapture: (e: ReactMouseEvent<SVGSVGElement>) => void
  }
}

function clampView(v: ViewState, w: number, h: number): ViewState {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale))
  const vw = w / scale
  const vh = h / scale
  return {
    scale,
    vx: Math.min(Math.max(v.vx, 0), w - vw),
    vy: Math.min(Math.max(v.vy, 0), h - vh),
  }
}

export function useDiagramZoom(w: number, h: number): DiagramZoom {
  const [view, setView] = useState<ViewState>({ scale: 1, vx: 0, vy: 0 })
  // Mirror for gesture handlers, which need the current view synchronously
  // (multiple pointermoves can land within one render).
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  }, [view])

  const elRef = useRef<SVGSVGElement | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; midX: number; midY: number } | null>(null)
  const travel = useRef(0)
  const suppressClick = useRef(false)

  const refCallback = useCallback((el: SVGSVGElement | null) => {
    elRef.current = el
  }, [])

  // Non-passive touchmove: claim two-finger gestures before the browser does
  // (React's synthetic touch listeners are passive, so this must be native).
  useEffect(() => {
    const el = elRef.current
    if (!el) return
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) e.preventDefault()
    }
    el.addEventListener("touchmove", onTouchMove, { passive: false })
    return () => el.removeEventListener("touchmove", onTouchMove)
  }, [])

  /** viewBox units per rendered CSS pixel at a given scale. */
  const unitsPerPx = useCallback(
    (scale: number) => {
      const rect = elRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0) return 1
      return w / scale / rect.width
    },
    [w],
  )

  const onPointerDown = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    travel.current = 0
    suppressClick.current = false
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
      }
    }
  }, [])

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const prev = pointers.current.get(e.pointerId)
      if (!prev) return
      const cur = { x: e.clientX, y: e.clientY }
      pointers.current.set(e.pointerId, cur)
      const el = elRef.current
      if (!el) return

      if (pointers.current.size === 2 && pinch.current) {
        const [a, b] = [...pointers.current.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        const midX = (a.x + b.x) / 2
        const midY = (a.y + b.y) / 2
        const { scale, vx, vy } = viewRef.current
        const factor = pinch.current.dist > 0 ? dist / pinch.current.dist : 1
        const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor))
        const rect = el.getBoundingClientRect()
        const uppOld = w / scale / rect.width
        const uppNew = w / nextScale / rect.width
        // Keep the world point under the pinch midpoint stationary, then add
        // the midpoint's own travel as a pan.
        const worldX = vx + (pinch.current.midX - rect.left) * uppOld
        const worldY = vy + (pinch.current.midY - rect.top) * uppOld
        const next = clampView(
          {
            scale: nextScale,
            vx: worldX - (midX - rect.left) * uppNew,
            vy: worldY - (midY - rect.top) * uppNew,
          },
          w,
          h,
        )
        pinch.current = { dist, midX, midY }
        suppressClick.current = true
        if (!el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId)
        setView(next)
        return
      }

      if (pointers.current.size === 1 && viewRef.current.scale > 1) {
        const dx = cur.x - prev.x
        const dy = cur.y - prev.y
        travel.current += Math.abs(dx) + Math.abs(dy)
        if (travel.current > DRAG_SLOP_PX) {
          suppressClick.current = true
          if (!el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId)
        }
        const upp = unitsPerPx(viewRef.current.scale)
        setView((v) =>
          clampView({ scale: v.scale, vx: v.vx - dx * upp, vy: v.vy - dy * upp }, w, h),
        )
      }
    },
    [w, h, unitsPerPx],
  )

  const endPointer = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    const el = elRef.current
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
  }, [])

  // A drag or pinch must not select the segment the finger happened to end
  // on — swallow the synthesized click once.
  const onClickCapture = useCallback((e: ReactMouseEvent<SVGSVGElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false
      e.preventDefault()
      e.stopPropagation()
    }
  }, [])

  const zoomBy = useCallback(
    (factor: number) => {
      setView((v) => {
        const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor))
        // Zoom about the center of the current view.
        const cx = v.vx + w / (2 * v.scale)
        const cy = v.vy + h / (2 * v.scale)
        return clampView(
          {
            scale: nextScale,
            vx: cx - w / (2 * nextScale),
            vy: cy - h / (2 * nextScale),
          },
          w,
          h,
        )
      })
    },
    [w, h],
  )

  const viewBox = useMemo(
    () =>
      `${view.vx.toFixed(2)} ${view.vy.toFixed(2)} ${(w / view.scale).toFixed(2)} ${(
        h / view.scale
      ).toFixed(2)}`,
    [view, w, h],
  )

  return {
    viewBox,
    scale: view.scale,
    view,
    isZoomed: view.scale > 1.001,
    zoomIn: () => zoomBy(BUTTON_STEP),
    zoomOut: () => zoomBy(1 / BUTTON_STEP),
    reset: () => setView({ scale: 1, vx: 0, vy: 0 }),
    svgProps: {
      ref: refCallback,
      style: { touchAction: view.scale > 1.001 ? "none" : "pan-y" },
      onPointerDown,
      onPointerMove,
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
      onClickCapture,
    },
  }
}
