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

export type LayoutSpan = { id: string; s: number; e: number }
/** Column slot for one span: render at `col` of `cols` equal sub-columns. */
export type SpanSlot = { col: number; cols: number }

/**
 * Classic calendar overlap layout for one day column. Spans that overlap in
 * time are grouped into clusters (maximal chains of transitively-overlapping
 * spans); within a cluster each span takes the first free sub-column, and every
 * span in the cluster is divided by the cluster's total column count so
 * concurrent shifts render side by side instead of stacking. Spans that touch
 * end-to-start (e === next.s) do NOT overlap. A lone span gets {col: 0, cols: 1}
 * (full width).
 */
export function layoutOverlappingSpans(
  spans: LayoutSpan[],
): Map<string, SpanSlot> {
  const out = new Map<string, SpanSlot>()
  // Start ascending; longer spans first on ties so they claim left columns.
  const sorted = [...spans].sort(
    (a, b) => a.s - b.s || b.e - a.e || a.id.localeCompare(b.id),
  )

  let cluster: { id: string; col: number }[] = []
  let colEnds: number[] = [] // per-column latest end within the cluster
  let clusterEnd = -Infinity

  const flush = () => {
    for (const m of cluster) out.set(m.id, { col: m.col, cols: colEnds.length })
    cluster = []
    colEnds = []
    clusterEnd = -Infinity
  }

  for (const sp of sorted) {
    if (sp.s >= clusterEnd) flush()
    let col = colEnds.findIndex((end) => end <= sp.s)
    if (col === -1) {
      col = colEnds.length
      colEnds.push(sp.e)
    } else {
      colEnds[col] = sp.e
    }
    cluster.push({ id: sp.id, col })
    clusterEnd = Math.max(clusterEnd, sp.e)
  }
  flush()
  return out
}
