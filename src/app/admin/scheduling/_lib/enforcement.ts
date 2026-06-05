// Shared hard-block enforcement for shift assignment.
//
// Every code path that attaches an employee to a shift (admin create/update,
// open-shift assign, swap approval, publish approval, and the staff self-claim
// RPC) runs the SAME check via the SECURITY DEFINER SQL function
// `scheduling_assignment_violations`, so the rules cannot drift or be bypassed.
//
// This is a plain module (not "use server"): it exports a pure label helper plus
// an async checker that the "use server" action files call with their own
// Supabase client.

// The RPC + new columns aren't in the generated DB types yet (see CLAUDE.md);
// cast through `any` at the call site, matching the offline_sync_queue /
// employee_job_areas convention.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any

export type AssignmentCheckArgs = {
  facilityId: string
  employeeId: string | null
  startsAt: string
  endsAt: string
  breakMinutes: number | null
  jobAreaId: string | null
  excludeShiftId: string | null
}

const VIOLATION_LABELS: Record<string, string> = {
  minor_overtime: "exceeds the weekly hour limit for minors",
  overtime: "pushes the employee past the overtime threshold",
  break_required: "is long enough to require a break that isn't scheduled",
  min_rest_between_shifts: "doesn't leave the required rest between shifts",
  double_booked: "overlaps another shift this employee is already on",
  unavailable: "falls within a time the employee marked unavailable",
  time_off: "overlaps approved time off",
  not_qualified: "is for a job area this employee isn't assigned to",
}

export function describeViolation(code: string): string {
  if (code.startsWith("cert_missing:")) {
    const cert = code.slice("cert_missing:".length)
    return `requires a certification the employee doesn't have (${cert})`
  }
  return VIOLATION_LABELS[code] ?? code
}

export function formatViolations(codes: string[]): string {
  const parts = codes.map(describeViolation)
  return `This assignment ${parts.join("; ")}.`
}

/** Returns the raw violation codes for an assignment (empty = allowed). */
export async function checkAssignmentViolations(
  supabase: AnySupabase,
  args: AssignmentCheckArgs
): Promise<string[]> {
  if (!args.employeeId) return []
  const { data, error } = await supabase.rpc("scheduling_assignment_violations", {
    p_facility_id: args.facilityId,
    p_employee_id: args.employeeId,
    p_starts: args.startsAt,
    p_ends: args.endsAt,
    p_break_minutes: args.breakMinutes ?? 0,
    p_job_area_id: args.jobAreaId,
    p_exclude_shift_id: args.excludeShiftId,
  })
  if (error) {
    throw new Error(error.message ?? "Failed to evaluate scheduling rules.")
  }
  return (data ?? []) as string[]
}

/** Gate helper: ok unless the assignment violates a hard block. */
export async function assertAssignable(
  supabase: AnySupabase,
  args: AssignmentCheckArgs
): Promise<{ ok: true } | { ok: false; error: string }> {
  const codes = await checkAssignmentViolations(supabase, args)
  if (codes.length === 0) return { ok: true }
  return { ok: false, error: formatViolations(codes) }
}
