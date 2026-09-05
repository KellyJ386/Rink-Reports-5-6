// Pure math for calendar drag interactions: pixel deltas to minute deltas,
// snapped moves, snapped resizes. Dependency-free so vitest runs it in
// plain Node; every timezone conversion stays in the components, at the
// single persist boundary, exactly like the rest of the grid.
//
// Everything operates on FACILITY-LOCAL minutes past midnight — the same
// coordinate system grid-model.ts renders in — and the DB's exclusion
// constraint remains the only overlap authority. Nothing here validates
// against other bookings; a drop that collides is refused by the server and
// rolled back visually.

export type GridExtent = { startMinute: number; endMinute: number }

/** Vertical pixels into minutes for a grid of the given rendered height. */
export function pixelsToMinutes(
  pixelDelta: number,
  gridHeightPx: number,
  extent: GridExtent,
): number {
  if (gridHeightPx <= 0) return 0
  const span = extent.endMinute - extent.startMinute
  return (pixelDelta / gridHeightPx) * span
}

export function snapMinute(minute: number, snapMinutes: number): number {
  if (snapMinutes <= 0) return Math.round(minute)
  return Math.round(minute / snapMinutes) * snapMinutes
}

/**
 * A move keeps the booking's duration and snaps its start. The result is
 * clamped so the whole booking stays inside [0, 1440) of its (possibly new)
 * day — cross-midnight rearranging is the sheet's job, not a drag's.
 */
export function applyMove(
  startMinute: number,
  endMinute: number,
  deltaMinutes: number,
  snapMinutes: number,
): { startMinute: number; endMinute: number } {
  const duration = endMinute - startMinute
  let nextStart = snapMinute(startMinute + deltaMinutes, snapMinutes)
  nextStart = Math.max(0, Math.min(1440 - duration, nextStart))
  return { startMinute: nextStart, endMinute: nextStart + duration }
}

/**
 * A resize drags the END edge only, snapped, never shorter than the snap
 * step (a zero-length booking is always a mistake) and never past midnight.
 */
export function applyResize(
  startMinute: number,
  endMinute: number,
  deltaMinutes: number,
  snapMinutes: number,
): { startMinute: number; endMinute: number } {
  const step = snapMinutes > 0 ? snapMinutes : 15
  let nextEnd = snapMinute(endMinute + deltaMinutes, snapMinutes)
  nextEnd = Math.max(startMinute + step, Math.min(1440, nextEnd))
  return { startMinute, endMinute: nextEnd }
}

/** True once a pointer has travelled far enough to mean "drag", not "click". */
export function passesDragThreshold(dxPx: number, dyPx: number, thresholdPx = 5): boolean {
  return Math.hypot(dxPx, dyPx) >= thresholdPx
}

/**
 * Which axis a move-drag locks to, from the pointer's travel so far: "x"
 * slides the block across columns at its original time, "y" slides it through
 * the day in its original column. A diagonal gesture must pick one — a block
 * that mirrors the finger both ways at once feels untethered, especially on
 * touch. Ties go to "y": time is the axis people drag most.
 */
export function dragAxis(dxPx: number, dyPx: number): "x" | "y" {
  return Math.abs(dxPx) > Math.abs(dyPx) ? "x" : "y"
}

/**
 * Drag-create: anchor slot + current pointer minute into a snapped range.
 * Dragging upward selects backwards from the anchor; a selection is never
 * shorter than one step.
 */
export function dragCreateRange(
  anchorMinute: number,
  pointerMinute: number,
  snapMinutes: number,
  extent: GridExtent,
): { startMinute: number; endMinute: number } {
  const step = snapMinutes > 0 ? snapMinutes : 30
  const a = snapMinute(anchorMinute, step)
  const p = snapMinute(pointerMinute, step)
  let start = Math.min(a, p)
  let end = Math.max(a, p)
  if (end - start < step) end = start + step
  start = Math.max(extent.startMinute, start)
  end = Math.min(extent.endMinute, Math.max(end, start + step))
  return { startMinute: start, endMinute: end }
}
