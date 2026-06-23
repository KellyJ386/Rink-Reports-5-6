// Advisory warning collection for the scheduling grid.
//
// Combines two sources into a single list of human-readable warning strings:
//   1. public.scheduling_assignment_violations() — the SAME engine the rest of
//      the app hard-blocks on (overlap/double-booking, approved time-off,
//      unavailability, overtime, required-cert gaps, job-area qualification).
//   2. The per-employee employees.max_weekly_hours cap, which that engine does
//      NOT cover (it uses facility-level thresholds), and which is the headline
//      check for the grid's weekly-hours tally.
//
// Plain module (not "use server"): the preview action and the create/update
// actions call it with their own RLS-scoped Supabase client.

import type { createClient } from "@/lib/supabase/server"

import { complianceWeekWindow } from "./compliance"
import { checkAssignmentViolations, describeViolation } from "./enforcement"
import { shiftDurationHours } from "./weekly-hours"

type ServerSupabase = Awaited<ReturnType<typeof createClient>>

export type WarningArgs = {
  facilityId: string
  employeeId: string | null
  startsAt: string
  endsAt: string
  breakMinutes: number | null
  jobAreaId: string | null
  excludeShiftId: string | null
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}

export type ShiftSignals = {
  /** Raw violation codes from scheduling_assignment_violations(). */
  codes: string[]
  /**
   * Human-readable per-employee weekly-hours cap warning (employees.
   * max_weekly_hours), or null when under cap / no cap set. The shared engine
   * does NOT cover this — it uses facility-level thresholds.
   */
  capWarning: string | null
}

/**
 * Compute the raw signals for assigning `employeeId` to the slot: the shared
 * engine's violation codes plus the per-employee hour-cap check. Callers
 * decide how to present/gate them (cert codes hard-block; the rest warn).
 */
export async function computeShiftSignals(
  supabase: ServerSupabase,
  args: WarningArgs
): Promise<ShiftSignals> {
  if (!args.employeeId) return { codes: [], capWarning: null }

  // 1. Shared engine (overlap, time-off, overtime, cert gaps, qualification…).
  const codes = await checkAssignmentViolations(supabase, args)

  // 2. Per-employee weekly-hours cap (employees.max_weekly_hours).
  const [{ data: emp }, { data: facility }, { data: settings }] =
    await Promise.all([
      supabase
        .from("employees")
        .select("max_weekly_hours")
        .eq("id", args.employeeId)
        .eq("facility_id", args.facilityId)
        .maybeSingle(),
      supabase
        .from("facilities")
        .select("timezone")
        .eq("id", args.facilityId)
        .maybeSingle<{ timezone: string | null }>(),
      supabase
        .from("schedule_settings")
        .select("week_start_day")
        .eq("facility_id", args.facilityId)
        .maybeSingle<{ week_start_day: number | null }>(),
    ])

  let capWarning: string | null = null
  const cap = emp?.max_weekly_hours
  if (cap != null) {
    const { startIso, endIso } = complianceWeekWindow(args.startsAt, {
      timezone: facility?.timezone ?? null,
      weekStartDay: settings?.week_start_day ?? 0,
    })
    let query = supabase
      .from("schedule_shifts")
      .select("starts_at, ends_at, break_minutes")
      .eq("employee_id", args.employeeId)
      .eq("facility_id", args.facilityId)
      .in("status", ["draft", "published"])
      .gte("starts_at", startIso)
      .lt("starts_at", endIso)
    if (args.excludeShiftId) query = query.neq("id", args.excludeShiftId)

    const { data: others } = await query
    const otherHours = (others ?? []).reduce(
      (sum, s) =>
        sum +
        shiftDurationHours(
          new Date(s.starts_at).getTime(),
          new Date(s.ends_at).getTime(),
          s.break_minutes ?? 0
        ),
      0
    )
    const thisHours = shiftDurationHours(
      new Date(args.startsAt).getTime(),
      new Date(args.endsAt).getTime(),
      args.breakMinutes ?? 0
    )
    const total = otherHours + thisHours
    if (total > cap) {
      capWarning = `Puts this employee at ${Math.round(total * 10) / 10}h this week, over their ${cap}h cap.`
    }
  }

  return { codes, capWarning }
}

/**
 * Returns human-readable advisory warnings for assigning `employeeId` to the
 * given slot. Empty array = clean. An open/unassigned slot yields no warnings.
 */
export async function collectShiftWarnings(
  supabase: ServerSupabase,
  args: WarningArgs
): Promise<string[]> {
  const { codes, capWarning } = await computeShiftSignals(supabase, args)
  const warnings = codes.map((code) => capitalize(describeViolation(code)) + ".")
  if (capWarning) warnings.push(capWarning)
  // De-dup while preserving order.
  return Array.from(new Set(warnings))
}
