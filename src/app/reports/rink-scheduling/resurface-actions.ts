"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireUser } from "@/lib/auth"
import { logServerError } from "@/lib/observability/log-server-error"
import { currentUserCan } from "@/lib/permissions/check"
import { canTransition, type ResurfaceLifecycleStatus } from "@/lib/rink-scheduling/resurface"
import { createClient } from "@/lib/supabase/server"

import type { SimpleResult } from "./_lib/types"

const CALENDAR_PATH = "/reports/rink-scheduling"

// ---------------------------------------------------------------------------
// Resurface lifecycle. Updating rink_bookings is edit-tier under RLS, so
// completing or skipping a cut is edit-tier by construction — the guard here
// exists to turn a silent zero-row RLS match into a sentence, exactly like
// the other actions in this module. facility_id always comes from the
// session.
// ---------------------------------------------------------------------------

async function requireEditor(): Promise<
  { ok: true; facilityId: string; employeeId: string | null } | { ok: false; error: string }
> {
  await requireUser()
  const current = await getCurrentUser()
  const profile = current?.profile
  if (!profile?.facility_id) {
    return { ok: false, error: "No facility assigned to your account." }
  }

  const supabase = await createClient()
  if (!(await currentUserCan(supabase, "rink_scheduling", "edit"))) {
    return { ok: false, error: "Managing resurfaces needs the Rink Scheduling edit permission." }
  }

  const { data: employee } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", current!.authUser.id)
    .eq("facility_id", profile.facility_id)
    .eq("is_active", true)
    .maybeSingle()

  return { ok: true, facilityId: profile.facility_id, employeeId: employee?.id ?? null }
}

function caught(e: unknown): { ok: false; error: string } {
  logServerError("reports/rink-scheduling/resurface-actions", e)
  return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
}

/**
 * Move a resurface booking through its lifecycle.
 *
 * The write is guarded on the CURRENT status (compare-and-set), so two staff
 * tapping different buttons at once cannot both "win": the second write
 * matches zero rows and reports what happened. resolved_by is stamped here
 * for terminal statuses; resolved_at and the back-to-scheduled clearing are
 * the coherence trigger's job (migration 266) — one owner per rule.
 *
 * `iceCutSubmissionId` optionally links the Ice Operations ice-cut record on
 * completion. It is verified to be THIS facility's ice_make submission before
 * the write; the composite FK would refuse a foreign one anyway, but the FK's
 * error names a constraint, not a reason.
 */
export async function setResurfaceStatus(input: {
  bookingId: string
  from: ResurfaceLifecycleStatus
  to: ResurfaceLifecycleStatus
  iceCutSubmissionId?: string | null
}): Promise<SimpleResult> {
  try {
    const ctx = await requireEditor()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    if (!canTransition(input.from, input.to)) {
      return { ok: false, error: "The cut is already in that state." }
    }

    const supabase = await createClient()

    let iceCutId: string | null = null
    if (input.to === "completed" && input.iceCutSubmissionId) {
      const { data: cut } = await supabase
        .from("ice_operations_submissions")
        .select("id")
        .eq("id", input.iceCutSubmissionId)
        .eq("facility_id", ctx.facilityId)
        .eq("operation_type", "ice_make")
        .maybeSingle()
      if (!cut) {
        return { ok: false, error: "That ice-cut record was not found for this facility." }
      }
      iceCutId = cut.id
    }

    const { data: rows, error } = await supabase
      .from("rink_bookings")
      .update({
        resurface_status: input.to,
        resurface_resolved_by:
          input.to === "scheduled" ? null : ctx.employeeId,
        // Linking is completion-only; skipping or rescheduling clears it so a
        // stale link never outlives the state that justified it.
        ice_cut_submission_id: input.to === "completed" ? iceCutId : null,
      })
      .eq("id", input.bookingId)
      .eq("facility_id", ctx.facilityId)
      .eq("resurface_status", input.from)
      .neq("status", "cancelled")
      .select("id")
    if (error) {
      return { ok: false, error: error.message || "Failed to update the resurface." }
    }
    if ((rows ?? []).length === 0) {
      return {
        ok: false,
        error: "The cut changed under you — reload to see its current state.",
      }
    }

    revalidatePath(CALENDAR_PATH)
    return { ok: true }
  } catch (e) {
    return caught(e)
  }
}

export type RecentIceCut = {
  id: string
  occurredAt: string
  rinkLabel: string | null
  equipmentLabel: string | null
}

/**
 * Recent ice-cut records to offer when completing a resurface. The two
 * modules keep SEPARATE rink registries, so this is a human-chosen link by
 * time proximity — the list is the facility's ice_make submissions from the
 * last 12 hours, newest first, labeled with the ice-operations rink and
 * zamboni names for recognition.
 */
export async function listRecentIceCuts(): Promise<
  { ok: true; cuts: RecentIceCut[] } | { ok: false; error: string }
> {
  try {
    const ctx = await requireEditor()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const supabase = await createClient()
    const since = new Date(Date.now() - 12 * 3_600_000).toISOString()

    const [{ data: cuts }, { data: rinks }, { data: equipment }] = await Promise.all([
      supabase
        .from("ice_operations_submissions")
        .select("id, occurred_at, rink_id, equipment_id")
        .eq("facility_id", ctx.facilityId)
        .eq("operation_type", "ice_make")
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: false })
        .limit(20),
      supabase
        .from("ice_operations_rinks")
        .select("id, name")
        .eq("facility_id", ctx.facilityId),
      supabase
        .from("ice_operations_equipment")
        .select("id, name")
        .eq("facility_id", ctx.facilityId),
    ])

    const rinkName = new Map((rinks ?? []).map((r) => [r.id, r.name]))
    const equipmentName = new Map((equipment ?? []).map((e) => [e.id, e.name]))

    return {
      ok: true,
      cuts: (cuts ?? []).map((c) => ({
        id: c.id,
        occurredAt: c.occurred_at,
        rinkLabel: c.rink_id ? (rinkName.get(c.rink_id) ?? null) : null,
        equipmentLabel: c.equipment_id ? (equipmentName.get(c.equipment_id) ?? null) : null,
      })),
    }
  } catch (e) {
    return caught(e)
  }
}
