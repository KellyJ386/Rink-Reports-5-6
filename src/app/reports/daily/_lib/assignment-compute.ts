// Pure, dependency-free helpers for the daily-report area-assignment flows.
// Kept free of server-only imports so vitest can cover them (see
// assignment-compute.test.ts and the vitest scoping note in CLAUDE.md).

/** Set-diff two assignee lists (duplicates and overlaps tolerated). */
export function diffAssignees(
  currentIds: string[],
  nextIds: string[],
): { toAdd: string[]; toRemove: string[] } {
  const current = new Set(currentIds)
  const next = new Set(nextIds)
  return {
    toAdd: [...next].filter((id) => !current.has(id)),
    toRemove: [...current].filter((id) => !next.has(id)),
  }
}

/**
 * Whether an assignment target date is inside the resolution window the DB
 * engine accepts (± windowDays around the server's today, both ISO
 * YYYY-MM-DD). Mirrors resolve_daily_area_assignments' guard so the action
 * can fail with a friendly message instead of a raw SQL error.
 */
export function isDateWithinAssignmentWindow(
  dateIso: string,
  todayIso: string,
  windowDays = 2,
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso) || !/^\d{4}-\d{2}-\d{2}$/.test(todayIso)) {
    return false
  }
  const date = Date.parse(`${dateIso}T00:00:00Z`)
  const today = Date.parse(`${todayIso}T00:00:00Z`)
  if (Number.isNaN(date) || Number.isNaN(today)) return false
  const days = Math.abs(date - today) / 86_400_000
  return days <= windowDays
}

export type AreaCompletion = {
  templatesTotal: number
  templatesDone: number
  /** An area counts as done for the day once ANY template has a submission. */
  done: boolean
}

/** Completion summary for one area from its template ids + the distinct
 *  template ids submitted today. Unknown submitted ids (inactive templates)
 *  still count toward done but not toward templatesDone. */
export function summarizeAreaCompletion(
  templateIds: string[],
  submittedTemplateIds: string[],
): AreaCompletion {
  const templates = new Set(templateIds)
  const submitted = new Set(submittedTemplateIds)
  let done = 0
  for (const id of submitted) if (templates.has(id)) done++
  return {
    templatesTotal: templates.size,
    templatesDone: done,
    done: submitted.size > 0,
  }
}
