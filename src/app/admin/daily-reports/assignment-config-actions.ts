"use server"

// Admin Control Center actions for daily-report assignment routing config
// (Phase 3): standing default owners per area, the area <-> scheduling
// job-area bridge, and the per-facility feature flag + pre-lock threshold.
// All writes require the daily module's admin grant (same double-gate as
// area-access-actions.ts: checked here AND by the RLS in migration 183).

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { logServerError } from "@/lib/observability/log-server-error"
import { currentUserCan } from "@/lib/permissions/check"
import { createClient } from "@/lib/supabase/server"

import type { SimpleResult } from "./types"

/** Same guard as actions.ts: RLS enforces the module-scoped admin grant. */
async function ensureDailyAdmin(): Promise<string | null> {
  await requireAdmin()
  const supabase = await createClient()
  const allowed = await currentUserCan(supabase, "daily_reports", "admin")
  return allowed
    ? null
    : "Your account has admin console access but not the daily reports module's admin permission. Ask an administrator to grant it under Admin → Permissions."
}

async function resolveFacility(): Promise<
  { ok: true; facilityId: string } | { ok: false; error: string }
> {
  const current = await getCurrentUser()
  const profile = current?.profile
  if (!profile) return { ok: false, error: "Not signed in." }
  if (!profile.facility_id) {
    return { ok: false, error: "No facility assigned to your account." }
  }
  return { ok: true, facilityId: profile.facility_id }
}

const uuid = z.string().uuid()

/**
 * Replace an area's standing default owners (multi-select, D2). Defaults feed
 * the resolution engine's lowest-priority branch; changing them affects
 * future materializations only.
 */
export async function setAreaDefaultOwners(input: {
  areaId: string
  employeeIds: string[]
}): Promise<SimpleResult> {
  try {
    const parsed = z
      .object({ areaId: uuid, employeeIds: z.array(uuid).max(50) })
      .safeParse(input)
    if (!parsed.success) return { ok: false, error: "Invalid input." }
    const denied = await ensureDailyAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const supabase = await createClient()
    const { areaId, employeeIds } = parsed.data

    const { data: area } = await supabase
      .from("daily_report_areas")
      .select("id")
      .eq("id", areaId)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    if (!area) return { ok: false, error: "Area not in your facility." }

    if (employeeIds.length > 0) {
      const { data: emps } = await supabase
        .from("employees")
        .select("id")
        .eq("facility_id", facility.facilityId)
        .eq("is_active", true)
        .in("id", employeeIds)
      if ((emps ?? []).length !== employeeIds.length) {
        return { ok: false, error: "One or more employees are not active members of your facility." }
      }
    }

    const { error: delErr } = await supabase
      .from("area_default_owners")
      .delete()
      .eq("area_id", areaId)
    if (delErr) return { ok: false, error: delErr.message }

    if (employeeIds.length > 0) {
      const { error: insErr } = await supabase.from("area_default_owners").insert(
        employeeIds.map((employeeId) => ({
          facility_id: facility.facilityId,
          area_id: areaId,
          employee_id: employeeId,
        })),
      )
      if (insErr) return { ok: false, error: insErr.message }
    }

    revalidatePath("/admin/daily-reports")
    return { ok: true }
  } catch (e) {
    logServerError("admin/daily-reports/assignment-config#setAreaDefaultOwners", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}

/**
 * Replace the scheduling job areas mapped to a daily area. The RLS with-check
 * additionally requires the caller to SEE the job areas (scheduling view) —
 * configuring the bridge needs visibility into both catalogs.
 */
export async function setAreaJobAreaMap(input: {
  areaId: string
  jobAreaIds: string[]
}): Promise<SimpleResult> {
  try {
    const parsed = z
      .object({ areaId: uuid, jobAreaIds: z.array(uuid).max(50) })
      .safeParse(input)
    if (!parsed.success) return { ok: false, error: "Invalid input." }
    const denied = await ensureDailyAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const supabase = await createClient()
    const { areaId, jobAreaIds } = parsed.data

    const { data: area } = await supabase
      .from("daily_report_areas")
      .select("id")
      .eq("id", areaId)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    if (!area) return { ok: false, error: "Area not in your facility." }

    const { error: delErr } = await supabase
      .from("daily_area_job_area_map")
      .delete()
      .eq("area_id", areaId)
    if (delErr) return { ok: false, error: delErr.message }

    if (jobAreaIds.length > 0) {
      const { error: insErr } = await supabase
        .from("daily_area_job_area_map")
        .insert(
          jobAreaIds.map((jobAreaId) => ({
            facility_id: facility.facilityId,
            area_id: areaId,
            job_area_id: jobAreaId,
          })),
        )
      if (insErr) return { ok: false, error: insErr.message }
    }

    revalidatePath("/admin/daily-reports")
    return { ok: true }
  } catch (e) {
    logServerError("admin/daily-reports/assignment-config#setAreaJobAreaMap", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}

/**
 * Per-facility routing flag + pre-lock warning threshold. Turning the flag
 * off reverts the module to open-report behavior instantly (the RLS helper
 * short-circuits); assignment history is retained.
 */
export async function updateAssignmentSettings(input: {
  enabled: boolean
  prelockWarningMinutes: number
}): Promise<SimpleResult> {
  try {
    const parsed = z
      .object({
        enabled: z.boolean(),
        prelockWarningMinutes: z.number().int().min(5).max(720),
      })
      .safeParse(input)
    if (!parsed.success) return { ok: false, error: "Invalid input." }
    const denied = await ensureDailyAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const supabase = await createClient()

    const { error } = await supabase.from("daily_report_settings").upsert(
      {
        facility_id: facility.facilityId,
        assignment_routing_enabled: parsed.data.enabled,
        prelock_warning_minutes: parsed.data.prelockWarningMinutes,
      },
      { onConflict: "facility_id" },
    )
    if (error) return { ok: false, error: error.message }

    revalidatePath("/admin/daily-reports")
    revalidatePath("/reports/daily")
    return { ok: true }
  } catch (e) {
    logServerError("admin/daily-reports/assignment-config#updateAssignmentSettings", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}
