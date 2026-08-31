"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireUser } from "@/lib/auth"
import { getFacilityTimezone } from "@/lib/facility-timezone"
import { logServerError } from "@/lib/observability/log-server-error"
import { currentUserCan } from "@/lib/permissions/check"
import { resolveResurfaceMinutes } from "@/lib/rink-scheduling/resurface"
import { planCutsForRinkDay, type PlannableBooking } from "@/lib/rink-scheduling/resurface-plan"
import { createClient } from "@/lib/supabase/server"
import { addDaysToKey, dayKeyInTz, minutesOfDayInTz } from "@/lib/timezone"

const CALENDAR_PATH = "/reports/rink-scheduling"

// ---------------------------------------------------------------------------
// "Plan today's cuts" — turn the gaps between rentals into explicit,
// trackable resurface bookings (the migration-265 lifecycle: scheduled ->
// completed with an Ice Operations link). Edit-tier, like every other write
// that shapes the published calendar.
//
// APPLY RE-COMPUTES THE PLAN SERVER-SIDE. The preview exists for human
// confirmation only; nothing a client saw is trusted as a placement. If the
// calendar moved between preview and apply, the recomputed plan simply
// reflects the new world, and any insert that still races loses to the
// overlap exclusion constraint and is reported as skipped.
// ---------------------------------------------------------------------------

type Ctx = { facilityId: string; employeeId: string | null }

async function requirePlanner(): Promise<
  { ok: true; ctx: Ctx } | { ok: false; error: string }
> {
  await requireUser()
  const current = await getCurrentUser()
  const profile = current?.profile
  if (!profile?.facility_id) {
    return { ok: false, error: "No facility assigned to your account." }
  }
  const supabase = await createClient()
  if (!(await currentUserCan(supabase, "rink_scheduling", "edit"))) {
    return { ok: false, error: "Planning cuts needs the Rink Scheduling edit permission." }
  }
  const { data: employee } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", current!.authUser.id)
    .eq("facility_id", profile.facility_id)
    .eq("is_active", true)
    .maybeSingle()
  return { ok: true, ctx: { facilityId: profile.facility_id, employeeId: employee?.id ?? null } }
}

export type PlannedCutView = {
  rinkId: string
  rinkName: string
  startsAtIso: string
  endsAtIso: string
  /** Facility-local minutes past midnight, for formatMinuteLabel. */
  startMinute: number
  endMinute: number
}

type ComputedPlan = {
  cuts: PlannedCutView[]
  cutTypeId: string | null
  /** The facility default buffer — surfaced so the preview can explain when
   *  planned cuts coexist with appended buffers. */
  bufferNote: boolean
}

async function computePlan(
  facilityId: string,
  dayKey: string,
  rinkId: string | null,
): Promise<ComputedPlan | { error: string }> {
  const supabase = await createClient()
  const timeZone = await getFacilityTimezone(supabase, facilityId)

  const [rinksRes, typesRes, settingsRes] = await Promise.all([
    supabase
      .from("facility_rinks")
      .select("id, name, resurface_minutes_override")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("rink_booking_types")
      .select("id, is_resurface, is_active")
      .eq("facility_id", facilityId),
    supabase
      .from("rink_scheduling_settings")
      .select("default_resurface_minutes, default_buffer_minutes, buffer_included_in_rental")
      .eq("facility_id", facilityId)
      .maybeSingle(),
  ])

  const rinks = (rinksRes.data ?? []).filter((r) => (rinkId ? r.id === rinkId : true))
  if (rinks.length === 0) return { error: "No matching rink is set up for this facility." }

  const types = typesRes.data ?? []
  const cutType = types.find((t) => t.is_resurface && t.is_active) ?? null
  const resurfaceTypeIds = new Set(types.filter((t) => t.is_resurface).map((t) => t.id))

  // The local day's bookings, fetched with a day of slack each side and then
  // filtered to the ones that START on dayKey — cuts are planned between
  // same-day neighbours.
  const { data: bookingRows } = await supabase
    .from("rink_bookings")
    .select("rink_id, booking_type_id, starts_at, ends_at, blocks_until")
    .eq("facility_id", facilityId)
    .neq("status", "cancelled")
    .gte("starts_at", `${addDaysToKey(dayKey, -1)}T00:00:00.000Z`)
    .lte("starts_at", `${addDaysToKey(dayKey, 1)}T23:59:59.999Z`)

  const byRink = new Map<string, PlannableBooking[]>()
  for (const b of bookingRows ?? []) {
    if (dayKeyInTz(b.starts_at, timeZone) !== dayKey) continue
    const list = byRink.get(b.rink_id) ?? []
    list.push({
      startMs: new Date(b.starts_at).getTime(),
      endMs: new Date(b.ends_at).getTime(),
      blocksUntilMs: new Date(b.blocks_until).getTime(),
      isResurface: resurfaceTypeIds.has(b.booking_type_id),
    })
    byRink.set(b.rink_id, list)
  }

  const settings = settingsRes.data
  const cuts: PlannedCutView[] = []
  for (const rink of rinks) {
    const cutMinutes = resolveResurfaceMinutes({
      facilityDefaultMinutes: settings?.default_resurface_minutes,
      rinkOverrideMinutes: rink.resurface_minutes_override,
    })
    for (const cut of planCutsForRinkDay(byRink.get(rink.id) ?? [], cutMinutes * 60_000)) {
      const startIso = new Date(cut.startMs).toISOString()
      const endIso = new Date(cut.endMs).toISOString()
      cuts.push({
        rinkId: rink.id,
        rinkName: rink.name,
        startsAtIso: startIso,
        endsAtIso: endIso,
        startMinute: minutesOfDayInTz(new Date(cut.startMs), timeZone),
        endMinute: minutesOfDayInTz(new Date(cut.endMs), timeZone),
      })
    }
  }

  return {
    cuts,
    cutTypeId: cutType?.id ?? null,
    bufferNote:
      (settings?.default_buffer_minutes ?? 15) > 0 &&
      !(settings?.buffer_included_in_rental ?? false),
  }
}

export type PlanPreviewResult =
  | { ok: true; cuts: PlannedCutView[]; hasCutType: boolean; bufferNote: boolean }
  | { ok: false; error: string }

export async function previewResurfacePlan(input: {
  dayKey: string
  rinkId?: string | null
}): Promise<PlanPreviewResult> {
  try {
    const gate = await requirePlanner()
    if (!gate.ok) return { ok: false, error: gate.error }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dayKey)) {
      return { ok: false, error: "Pick a valid date." }
    }

    const plan = await computePlan(gate.ctx.facilityId, input.dayKey, input.rinkId ?? null)
    if ("error" in plan) return { ok: false, error: plan.error }
    return { ok: true, cuts: plan.cuts, hasCutType: plan.cutTypeId !== null, bufferNote: plan.bufferNote }
  } catch (e) {
    logServerError("reports/rink-scheduling/resurface-plan-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export type PlanApplyResult =
  | { ok: true; created: number; skipped: number }
  | { ok: false; error: string }

export async function applyResurfacePlan(input: {
  dayKey: string
  rinkId?: string | null
}): Promise<PlanApplyResult> {
  try {
    const gate = await requirePlanner()
    if (!gate.ok) return { ok: false, error: gate.error }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dayKey)) {
      return { ok: false, error: "Pick a valid date." }
    }

    const { facilityId, employeeId } = gate.ctx
    const plan = await computePlan(facilityId, input.dayKey, input.rinkId ?? null)
    if ("error" in plan) return { ok: false, error: plan.error }
    if (!plan.cutTypeId) {
      return {
        ok: false,
        error:
          "No active Ice Resurface booking type is set up. Create one on the Lists tab of Rink Scheduling admin first.",
      }
    }
    if (plan.cuts.length === 0) return { ok: true, created: 0, skipped: 0 }

    const supabase = await createClient()
    let created = 0
    let skipped = 0
    for (const cut of plan.cuts) {
      const { error } = await supabase.from("rink_bookings").insert({
        facility_id: facilityId,
        rink_id: cut.rinkId,
        booking_type_id: plan.cutTypeId,
        customer_id: null,
        title: null,
        starts_at: cut.startsAtIso,
        ends_at: cut.endsAtIso,
        // A cut needs no buffer after itself — the cut IS the maintenance.
        buffer_minutes_after: 0,
        status: "confirmed",
        created_by: employeeId,
      })
      if (error) {
        // 23P01: the world moved between compute and insert; the constraint
        // is the referee, the cut is simply skipped and reported.
        skipped++
      } else {
        created++
      }
    }

    revalidatePath(CALENDAR_PATH)
    return { ok: true, created, skipped }
  } catch (e) {
    logServerError("reports/rink-scheduling/resurface-plan-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}
