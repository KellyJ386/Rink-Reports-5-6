// Pure geometry helpers for the custom scheduling week board.
//
// The board renders an hour-row grid (one row per operating hour) with shift
// blocks absolutely positioned by decimal-hour math. All of these helpers work
// on plain numbers so they stay dependency-free and unit-testable (see
// grid-geometry.test.ts) — no DOM, no Date, no server-only imports. Callers
// convert Dates to decimal local hours before handing values in here.

/** Format a decimal hour (e.g. 14.5) as a compact label like "2:30p" / "6a". */
export function fmtHour(h: number): string {
  const hr = Math.floor(h)
  const m = Math.round((h - hr) * 60)
  const ampm = hr >= 12 && hr < 24 ? "p" : "a"
  const hh = ((hr + 11) % 12) + 1
  return m ? `${hh}:${m.toString().padStart(2, "0")}${ampm}` : `${hh}${ampm}`
}

/** Snap a decimal hour to the nearest `step` (default 15 min = 0.25h). */
export function snapHour(h: number, step = 0.25): number {
  return Math.round(h / step) * step
}

/** Clamp a decimal hour into [min, max]. */
export function clampHour(h: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, h))
}

/** Pixel offset (from the top of the body) for a decimal hour. */
export function hoursToY(hour: number, hourStart: number, rowH: number): number {
  return (hour - hourStart) * rowH
}

/**
 * Convert a pixel y-offset (from the top of the grid body) back to a decimal
 * hour, snapped to `step` and clamped to [hourStart, hourEnd].
 */
export function yToHour(
  y: number,
  hourStart: number,
  hourEnd: number,
  rowH: number,
  step = 0.25,
): number {
  const raw = hourStart + y / rowH
  return clampHour(snapHour(raw, step), hourStart, hourEnd)
}

/** Top/height (px) for a shift block spanning [s, e] decimal hours. */
export function blockRect(
  s: number,
  e: number,
  hourStart: number,
  rowH: number,
): { top: number; height: number } {
  const top = hoursToY(s, hourStart, rowH) + 1
  const height = Math.max(rowH * 0.5, (e - s) * rowH - 2)
  return { top, height }
}

export type CoverageSpan = { day: number; s: number; e: number }

/**
 * Count concurrent shifts per (day, hour) cell. Returns a 7×hourCount grid
 * where grid[day][i] = number of spans active during the hour
 * `hourStart + i`. Used to paint the optional coverage heatmap.
 */
export function buildCoverageGrid(
  spans: CoverageSpan[],
  hourStart: number,
  hourCount: number,
): number[][] {
  const grid: number[][] = Array.from({ length: 7 }, () =>
    Array(hourCount).fill(0),
  )
  for (const sp of spans) {
    if (sp.day < 0 || sp.day > 6) continue
    for (let i = 0; i < hourCount; i++) {
      const h = hourStart + i
      if (h >= sp.s && h < sp.e) grid[sp.day][i] += 1
    }
  }
  return grid
}

/** Decimal local hour (0–24) for a Date in the browser's timezone. */
export function dateToDecimalHour(d: Date): number {
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
}
