"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import type { ActionState } from "./types"

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  if (err.code === "23505") return "A retention rule for this module already exists."
  return err.message?.trim() || fallback
}

async function resolveFacility(): Promise<
  { ok: true; facilityId: string } | { ok: false; error: string }
> {
  // requireAdmin() redirects to /login or /forbidden if the caller is not an
  // admin-level user, so unauthenticated / unauthorized calls never reach the upsert.
  const { profile } = await requireAdmin()
  if (!profile?.facility_id) return { ok: false, error: "No facility assigned." }
  return { ok: true, facilityId: profile.facility_id }
}

export async function upsertRetentionSetting(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const res = await resolveFacility()
  if (!res.ok) return { ok: false, error: res.error }
  const { facilityId } = res

  const moduleKey = formData.get("module_key")
  const keepDaysRaw = formData.get("keep_days")
  const autoPurge = formData.get("auto_purge") === "on"

  const KNOWN_MODULE_KEYS = new Set([
    "daily_reports",
    "incident_reports",
    "accident_reports",
    "communications",
    "refrigeration",
    "air_quality",
    "ice_operations",
    "scheduling",
  ])

  if (typeof moduleKey !== "string" || !moduleKey.trim()) {
    return { ok: false, error: "Module key is required." }
  }
  if (!KNOWN_MODULE_KEYS.has(moduleKey.trim())) {
    return { ok: false, error: "Invalid module key." }
  }
  const keepDays = parseInt(String(keepDaysRaw), 10)
  if (!Number.isFinite(keepDays) || keepDays < 30) {
    return { ok: false, error: "Keep days must be at least 30." }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("retention_settings")
    .upsert(
      {
        facility_id: facilityId,
        module_key: moduleKey.trim(),
        keep_days: keepDays,
        auto_purge: autoPurge,
      },
      { onConflict: "facility_id,module_key" },
    )

  if (error) return { ok: false, error: dbError(error, "Failed to save retention setting.") }

  revalidatePath("/admin/retention")
  return { ok: true, message: "Retention setting saved." }
}
