// Pure compliance math for shift assignment: net worked hours, the
// facility-local week window used for weekly summing, and the minor/overtime
// threshold evaluation. NO server-only imports live here, so this module is
// safe to unit-test in isolation (see compliance.test.ts);
// admin-core-actions.ts and grid-warnings.ts add the Supabase I/O.

import { addDaysToKey, dayKeyInTz, wallTimeToUtc } from "@/lib/timezone"

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

export type WeekWindowOptions = {
  /** IANA facility timezone; null falls back to the runtime's local zone. */
  timezone: string | null
  /** 0 = Sunday … 6 = Saturday (schedule_settings.week_start_day). */
  weekStartDay?: number
}

/**
 * [start, end) ISO bounds of the compliance week containing `startsAt`,
 * computed on the FACILITY's calendar: the week runs from local midnight of
 * the facility's week-start day to local midnight seven days later (so a
 * Saturday-evening shift in a US facility counts toward the right week, and
 * DST weeks are 167/169 real hours). Matches the window used by
 * scheduling_assignment_violations() (migration 137).
 */
export function complianceWeekWindow(
  startsAt: string,
  opts: WeekWindowOptions
): {
  startIso: string
  endIso: string
} {
  const weekStartDay = ((opts.weekStartDay ?? 0) % 7 + 7) % 7
  const dayKey = dayKeyInTz(startsAt, opts.timezone)
  const [y, m, d] = dayKey.split("-").map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
  const weekStartKey = addDaysToKey(dayKey, -((dow - weekStartDay + 7) % 7))
  const start = wallTimeToUtc(`${weekStartKey}T00:00:00`, opts.timezone)
  const end = wallTimeToUtc(
    `${addDaysToKey(weekStartKey, 7)}T00:00:00`,
    opts.timezone
  )
  if (!start || !end) {
    // Unreachable for well-formed keys; keep a deterministic fallback.
    const s = new Date(startsAt)
    return { startIso: s.toISOString(), endIso: s.toISOString() }
  }
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
