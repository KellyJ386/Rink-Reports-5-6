// Pure helpers for the weekly-hours tally shown in the scheduling grid's side
// rail. Dependency-free so it can be unit-tested (see weekly-hours.test.ts).

export type TallyItem = {
  employeeId: string | null
  startMs: number
  endMs: number
  breakMinutes: number
}

/** Worked hours for one shift: gross duration minus break, floored at 0. */
export function shiftDurationHours(
  startMs: number,
  endMs: number,
  breakMinutes: number
): number {
  const gross = (endMs - startMs) / 3_600_000
  const net = gross - (breakMinutes || 0) / 60
  return net > 0 ? net : 0
}

/**
 * Sum worked hours per employee for shifts whose start falls within
 * [weekStartMs, weekEndMs). Unassigned shifts (employeeId null) are ignored.
 */
export function tallyWeeklyHoursByEmployee(
  items: TallyItem[],
  weekStartMs: number,
  weekEndMs: number
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const it of items) {
    if (!it.employeeId) continue
    if (it.startMs < weekStartMs || it.startMs >= weekEndMs) continue
    const prev = totals.get(it.employeeId) ?? 0
    totals.set(
      it.employeeId,
      prev + shiftDurationHours(it.startMs, it.endMs, it.breakMinutes)
    )
  }
  return totals
}

/** Round to one decimal for display (e.g. 37.5). */
export function roundHours(hours: number): number {
  return Math.round(hours * 10) / 10
}
