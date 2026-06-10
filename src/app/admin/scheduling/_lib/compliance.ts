// Pure compliance math for shift assignment: net worked hours, the
// Sunday-anchored UTC week window used for weekly summing, and the
// minor/overtime threshold evaluation. NO server-only imports live here, so
// this module is safe to unit-test in isolation (see compliance.test.ts);
// admin-core-actions.ts and grid-warnings.ts add the Supabase I/O.

export type SettingsForCompliance = {
  minor_max_weekly_hours: number | null
  overtime_weekly_hours: number | null
}

export type EmployeeForCompliance = {
  id: string
  is_minor: boolean
}

export type ShiftForHours = {
  starts_at: string
  ends_at: string
  break_minutes: number | null
}

/** Net worked hours for one shift: gross minus break, floored at 0. */
export function shiftHours(s: ShiftForHours): number {
  const ms = new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()
  const minutes = Math.max(0, ms / 60000) - (s.break_minutes ?? 0)
  return Math.max(0, minutes / 60)
}

/**
 * Start (UTC midnight) of the Sunday-anchored week containing `date`.
 * Compliance hour-summing always uses Sun–Sat regardless of the facility's
 * display week, matching the window used by scheduling_assignment_violations().
 */
export function startOfWeekUTC(date: string): Date {
  const d = new Date(date)
  const start = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  )
  start.setUTCDate(start.getUTCDate() - d.getUTCDay())
  return start
}

/** [start, end) ISO bounds of the compliance week containing `startsAt`. */
export function complianceWeekWindow(startsAt: string): {
  startIso: string
  endIso: string
} {
  const start = startOfWeekUTC(startsAt)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 7)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

/**
 * Evaluate the facility-level weekly-hour warnings for adding `shift` on top
 * of `otherShifts` (the employee's existing draft/published shifts in the
 * same compliance week). Returns warning codes: `minor_overtime` when a minor
 * crosses the minor cap, `overtime` when anyone crosses the overtime
 * threshold. Null settings values disable the corresponding check.
 */
export function evaluateComplianceWarnings(args: {
  shift: ShiftForHours
  otherShifts: ShiftForHours[]
  settings: SettingsForCompliance
  employee: EmployeeForCompliance
}): string[] {
  const { shift, otherShifts, settings, employee } = args
  const totalHours =
    otherShifts.reduce((sum, s) => sum + shiftHours(s), 0) + shiftHours(shift)

  const warnings: string[] = []
  if (
    employee.is_minor &&
    settings.minor_max_weekly_hours != null &&
    totalHours > Number(settings.minor_max_weekly_hours)
  ) {
    warnings.push("minor_overtime")
  }
  if (
    settings.overtime_weekly_hours != null &&
    totalHours > Number(settings.overtime_weekly_hours)
  ) {
    warnings.push("overtime")
  }
  return warnings
}
