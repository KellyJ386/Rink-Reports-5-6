// Pure helpers for URL-param-driven "Load more" pagination on server-rendered
// admin lists. The list page reads `?show=N` (clamped here), queries
// `.range(0, N)` — i.e. N+1 rows — and shows a "Load more" link pointing at
// the next clamped size while more rows exist. Dependency-free so it can be
// unit-tested (see pagination.test.ts).

export type ShowOptions = {
  /** Rows rendered on first load (also the step size unless overridden). */
  initial: number
  /** How many more rows each "Load more" click requests. */
  step?: number
  /** Hard ceiling so a crafted URL can't request an unbounded result set. */
  max?: number
}

export const SHOW_MAX_DEFAULT = 2000

/** Parse and clamp a raw `?show=` value to [initial, max]. */
export function clampShow(raw: string | undefined, opts: ShowOptions): number {
  const max = opts.max ?? SHOW_MAX_DEFAULT
  const n = Number.parseInt(raw ?? "", 10)
  if (!Number.isFinite(n)) return Math.min(opts.initial, max)
  return Math.min(Math.max(n, opts.initial), max)
}

/** The next page size after `current`, or null when the ceiling is reached. */
export function nextShow(current: number, opts: ShowOptions): number | null {
  const max = opts.max ?? SHOW_MAX_DEFAULT
  if (current >= max) return null
  return Math.min(current + (opts.step ?? opts.initial), max)
}
