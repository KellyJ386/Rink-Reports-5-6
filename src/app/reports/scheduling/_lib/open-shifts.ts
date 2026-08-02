// Shared open-shift ("pick up") loading for the staff scheduling surfaces.
//
// Both the scheduling hub (/reports/scheduling) and My Schedule
// (/reports/scheduling/my-schedule) show the same two lists — shifts that are
// open for claiming, and the caller's own claims still awaiting an admin
// decision. This module is the single definition of both, so the two pages
// cannot drift on the window, the ordering, or what counts as claimable.
//
// The selection helpers are pure (no Supabase, no Date.now()) so they are
// unit-tested directly; only `loadOpenShiftBoard` touches the database.

import type { createClient } from "@/lib/supabase/server"

type ServerSupabase = Awaited<ReturnType<typeof createClient>>

/**
 * How far ahead a shift may start and still be advertised as claimable.
 * The dashboard badge (src/lib/scheduling/unread.ts) counts the same window,
 * so the number a user sees on the tile matches the list they land on.
 */
export const OPEN_SHIFT_WINDOW_DAYS = 14

/** How many open shifts each surface lists before "view all". */
export const OPEN_SHIFT_LIST_LIMIT = 5

export type OpenShiftShift = {
  id: string
  starts_at: string
  ends_at: string
  role_label: string | null
  department_id: string | null
  departments: { name: string } | null
}

export type OpenShiftRow = {
  id: string
  approval_required: boolean
  claim_status: string
  claimed_by_employee_id: string | null
  schedule_shifts: OpenShiftShift | null
}

/** An open-shift row guaranteed to carry its parent shift. */
export type ClaimableOpenShift = OpenShiftRow & {
  schedule_shifts: OpenShiftShift
}

const SELECT =
  "id, approval_required, claim_status, claimed_by_employee_id, " +
  "schedule_shifts(id, starts_at, ends_at, role_label, department_id, departments(name))"

/**
 * Claimable shifts: still `open`, parent shift present, starting between now
 * and the window end. Sorted soonest-first and capped.
 *
 * A shift that already started is dropped even if the listing is still open —
 * offering someone a shift they cannot get to is worse than showing nothing.
 */
export function selectClaimableOpenShifts(
  rows: OpenShiftRow[],
  opts: { nowMs: number; windowEndMs: number; limit?: number }
): ClaimableOpenShift[] {
  return rows
    .filter((row): row is ClaimableOpenShift => {
      if (!row.schedule_shifts || row.claim_status !== "open") return false
      const startMs = new Date(row.schedule_shifts.starts_at).getTime()
      if (Number.isNaN(startMs)) return false
      return startMs >= opts.nowMs && startMs <= opts.windowEndMs
    })
    .sort(
      (a, b) =>
        new Date(a.schedule_shifts.starts_at).getTime() -
        new Date(b.schedule_shifts.starts_at).getTime()
    )
    .slice(0, opts.limit ?? OPEN_SHIFT_LIST_LIMIT)
}

/**
 * The caller's own claims awaiting an admin decision. Without this a claimed
 * shift just disappears from the open list with no trace for the claimant.
 * Not windowed or capped: a pending claim matters however far out it sits.
 */
export function selectMyPendingClaims(
  rows: OpenShiftRow[],
  employeeId: string
): ClaimableOpenShift[] {
  return rows
    .filter(
      (row): row is ClaimableOpenShift =>
        row.claim_status === "claimed" &&
        row.claimed_by_employee_id === employeeId &&
        row.schedule_shifts !== null
    )
    .sort(
      (a, b) =>
        new Date(a.schedule_shifts.starts_at).getTime() -
        new Date(b.schedule_shifts.starts_at).getTime()
    )
}

/**
 * Load both lists for one employee. `facilityId` and `employeeId` must be
 * server-resolved; the read is additionally RLS-scoped
 * (schedule_open_shifts_select requires has_module_access('scheduling') and a
 * matching facility), so a caller without scheduling access simply reads none.
 */
export async function loadOpenShiftBoard(
  supabase: ServerSupabase,
  opts: {
    facilityId: string
    employeeId: string
    now: Date
    limit?: number
  }
): Promise<{
  openShifts: ClaimableOpenShift[]
  myPendingClaims: ClaimableOpenShift[]
}> {
  const { data } = await supabase
    .from("schedule_open_shifts")
    .select(SELECT)
    .eq("facility_id", opts.facilityId)
    .in("claim_status", ["open", "claimed"])

  const rows = (data ?? []) as unknown as OpenShiftRow[]
  const nowMs = opts.now.getTime()
  const windowEndMs = nowMs + OPEN_SHIFT_WINDOW_DAYS * 24 * 60 * 60 * 1000

  return {
    openShifts: selectClaimableOpenShifts(rows, {
      nowMs,
      windowEndMs,
      limit: opts.limit,
    }),
    myPendingClaims: selectMyPendingClaims(rows, opts.employeeId),
  }
}
