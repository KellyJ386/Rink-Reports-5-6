// Pure helpers for the saved-shift start/end TIME editor in the assign popover.
//
// Editing a shift's times changes only the time-of-day, keeping the shift's
// existing calendar date (the grid places a block by its start day). These
// helpers convert between a JS Date and an <input type="time"> "HH:MM" string
// without touching the date, so the popover can offer real time inputs while
// the persisted starts_at/ends_at stay anchored to the right day. Plain
// functions — no DOM, no server-only imports — so they're unit-tested
// (time-edit.test.ts) alongside the other pure scheduling logic.

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

/** A Date → "HH:MM" (24h, local) for an <input type="time"> value. */
export function toTimeInput(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/**
 * Apply an "HH:MM" time-of-day to `base`, preserving its year/month/day. A
 * malformed or out-of-range string returns a clone of `base` unchanged, so a
 * half-typed input never corrupts the shift's date.
 */
export function withTime(base: Date, hhmm: string): Date {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  const d = new Date(base)
  if (!m) return d
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return d
  d.setHours(h, min, 0, 0)
  return d
}

/** True when end is strictly after start (the persistable condition). */
export function isEndAfterStart(start: Date, end: Date): boolean {
  return end.getTime() > start.getTime()
}
