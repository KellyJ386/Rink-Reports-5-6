// Pure move math for the scheduling week board's KEYBOARD drag-and-drop.
//
// The board's mouse/touch drag is handled by hand-rolled Pointer Events in
// week-grid.tsx. The keyboard path is layered on @dnd-kit's KeyboardSensor:
// arrow keys translate the picked-up block by a whole column (day) or one hour
// row, and on drop @dnd-kit hands us a pixel delta. These helpers turn that
// pixel delta into a clamped (day, start, end) move, preserving the block's
// duration. Plain numbers only — no DOM, no Date, no @dnd-kit imports — so they
// stay dependency-free and unit-testable (see keyboard-move.test.ts), exactly
// like grid-geometry.ts next door.

import { clampHour, snapHour } from "./grid-geometry"

export type GridMovePos = {
  /** Day column index within the visible window (0 = first column). */
  dayIndex: number
  /** Decimal local hour the block starts at (e.g. 9.5 = 9:30am). */
  startHour: number
  /** Decimal local hour the block ends at. */
  endHour: number
}

export type GridBounds = {
  /** Number of visible day columns (1 in day view, 7 in week view). */
  dayCount: number
  /** First/last hour rows of the visible grid window. */
  hourStart: number
  hourEnd: number
}

export type GridGeom = {
  /** Pixel width of one day column. */
  colWidth: number
  /** Pixel height of one hour row. */
  rowH: number
  /** Snap granularity for the vertical move, in decimal hours (default 15min). */
  hourStep?: number
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

/**
 * Convert a pixel drag delta into a grid delta: whole days horizontally and
 * (snapped) decimal hours vertically. Guards against a zero column width / row
 * height so a not-yet-measured grid can't divide by zero.
 */
export function pixelDeltaToGridDelta(
  px: { x: number; y: number },
  geom: GridGeom,
): { days: number; hours: number } {
  const days = geom.colWidth > 0 ? Math.round(px.x / geom.colWidth) : 0
  const rawHours = geom.rowH > 0 ? px.y / geom.rowH : 0
  const hours = snapHour(rawHours, geom.hourStep ?? 0.25)
  return { days, hours }
}

/**
 * Apply a (days, hours) delta to a block, preserving its duration and clamping
 * the whole block inside the visible window:
 *  - the day index is clamped to [0, dayCount - 1];
 *  - the start hour is clamped so the block's END never spills past hourEnd
 *    (and the start never precedes hourStart).
 * The returned end is always start + original duration.
 */
export function applyGridDelta(
  pos: GridMovePos,
  delta: { days: number; hours: number },
  bounds: GridBounds,
): GridMovePos {
  const duration = pos.endHour - pos.startHour
  const dayIndex = clampInt(
    pos.dayIndex + delta.days,
    0,
    Math.max(0, bounds.dayCount - 1),
  )
  // The latest start that still leaves room for the full duration.
  const maxStart = Math.max(bounds.hourStart, bounds.hourEnd - duration)
  const startHour = clampHour(
    pos.startHour + delta.hours,
    bounds.hourStart,
    maxStart,
  )
  return { dayIndex, startHour, endHour: startHour + duration }
}

/** True when a computed move actually changes the block's day or start. */
export function isRealMove(from: GridMovePos, to: GridMovePos): boolean {
  return to.dayIndex !== from.dayIndex || Math.abs(to.startHour - from.startHour) > 1e-6
}
