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
import { dayKeyInTz, minutesOfDayInTz } from "@/lib/timezone"

import { complianceWeekWindow } from "./compliance"
import { checkAssignmentViolations, describeViolation } from "./enforcement"
import { daysBetween } from "../shifts/_lib/recurrence"
import {
  isOutsideOperatingHours,
  resolveOperatingHours,
} from "./operating-hours"
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

/** "HH:MM" (24h) → a compact 12h label like "6 AM" / "11:30 PM" / "midnight". */
function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number)
  if (h === 24 || (h === 0 && m === 0)) return "midnight"
  const ampm = h >= 12 ? "PM" : "AM"
  const hh = ((h + 11) % 12) + 1
  return m ? `${hh}:${String(m).padStart(2, "0")} ${ampm}` : `${hh} ${ampm}`
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
  /**
   * Advisory when the shift falls outside the facility's configured operating
   * hours (schedule_settings.operating_hours_*_minute, with the legacy
   * facilities.settings jsonb as a fallback), compared in the facility's
   * timezone. Null when within hours. Surfaced as a confirm-to-save
   * advisory (or a hard block when the facility opts into block_on_violations) —
   * NOT a standalone hard block, so legitimate before-open / after-close shifts
   * (setup, maintenance) remain savable with acknowledgement.
   */
  boundsWarning: string | null
}

/**
 * Compute the raw signals for assigning `employeeId` to the slot: the shared
 * engine's violation codes plus the per-employee hour-cap check. Callers
 * decide how to present/gate them (cert codes hard-block; the rest warn).
 */
/**
 * The facility/employee-CONSTANT lookups computeShiftSignals needs: the
 * employee's weekly-hours cap, the facility timezone/settings, and the
 * schedule_settings row. For a single slot computeShiftSignals loads these
 * itself; for a recurring series (one employee, one facility, up to 62
 * occurrences) the caller loads them ONCE via loadShiftSignalsContext and
 * passes them in, so only the genuinely per-slot work (the violations RPC and
 * the weekly-hours window query) repeats per occurrence.
 */
export type ShiftSignalsContext = {
  employee: { max_weekly_hours: number | null } | null
  facility: { timezone: string | null; settings: unknown } | null
  settings: {
    week_start_day: number | null
    operating_hours_start_minute: number | null
    operating_hours_end_minute: number | null
  } | null
}

export async function loadShiftSignalsContext(
  supabase: ServerSupabase,
  facilityId: string,
  employeeId: string
): Promise<ShiftSignalsContext> {
  const [{ data: employee }, { data: facility }, { data: settings }] =
    await Promise.all([
      supabase
        .from("employees")
        .select("max_weekly_hours")
        .eq("id", employeeId)
        .eq("facility_id", facilityId)
        .maybeSingle<{ max_weekly_hours: number | null }>(),
      supabase
        .from("facilities")
        .select("timezone, settings")
        .eq("id", facilityId)
        .maybeSingle<{ timezone: string | null; settings: unknown }>(),
      supabase
        .from("schedule_settings")
        .select(
          "week_start_day, operating_hours_start_minute, operating_hours_end_minute"
        )
        .eq("facility_id", facilityId)
        .maybeSingle<{
          week_start_day: number | null
          operating_hours_start_minute: number | null
          operating_hours_end_minute: number | null
        }>(),
    ])
  return { employee, facility, settings }
}

export async function computeShiftSignals(
  supabase: ServerSupabase,
  args: WarningArgs,
  context?: ShiftSignalsContext
): Promise<ShiftSignals> {
  if (!args.employeeId) return { codes: [], capWarning: null, boundsWarning: null }

  // 1. Shared engine (overlap, time-off, overtime, cert gaps, qualification…).
  const codes = await checkAssignmentViolations(supabase, args)

  // 2. Facility/employee-constant lookups — supplied by the caller for a
  //    recurring series (hoisted out of the per-occurrence loop), otherwise
  //    loaded here for a single slot.
  const { employee: emp, facility, settings } =
    context ?? (await loadShiftSignalsContext(supabase, args.facilityId, args.employeeId))

  // 3. Operating-hours bounds (facility-local). Advisory only.
  const oh = resolveOperatingHours(settings, facility?.settings)
  const tz = facility?.timezone ?? null
  const outsideHours = isOutsideOperatingHours({
    startMinute: minutesOfDayInTz(args.startsAt, tz),
    endMinute: minutesOfDayInTz(args.endsAt, tz),
    endDayOffset: daysBetween(
      dayKeyInTz(args.startsAt, tz),
      dayKeyInTz(args.endsAt, tz)
    ),
    hours: oh,
  })
  const boundsWarning = outsideHours
    ? `Falls outside operating hours (${fmt12(oh.start)}–${fmt12(oh.end)}).`
    : null

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

  return { codes, capWarning, boundsWarning }
}

/**
 * Returns human-readable advisory warnings for assigning `employeeId` to the
 * given slot. Empty array = clean. An open/unassigned slot yields no warnings.
 */
export async function collectShiftWarnings(
  supabase: ServerSupabase,
  args: WarningArgs
): Promise<string[]> {
  const { codes, capWarning, boundsWarning } = await computeShiftSignals(
    supabase,
    args
  )
  const warnings = codes.map((code) => capitalize(describeViolation(code)) + ".")
  if (capWarning) warnings.push(capWarning)
  if (boundsWarning) warnings.push(boundsWarning)
  // De-dup while preserving order.
  return Array.from(new Set(warnings))
}
