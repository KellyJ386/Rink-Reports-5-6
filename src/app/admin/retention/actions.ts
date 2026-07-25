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
  const { profile } = await requireAdmin()
  if (!profile?.facility_id) return { ok: false, error: "No facility assigned." }
  return { ok: true, facilityId: profile.facility_id }
}

const KNOWN_MODULE_KEYS = new Set([
  "daily_reports",
  "ice_depth",
  "ice_operations",
  "incident_reports",
  "accident_reports",
  "communications",
  "refrigeration",
  "air_quality",
  "scheduling",
  "audit_logs",
])

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

  if (typeof moduleKey !== "string" || !moduleKey.trim()) {
    return { ok: false, error: "Module key is required." }
  }
  if (!KNOWN_MODULE_KEYS.has(moduleKey.trim())) {
    return { ok: false, error: "Invalid module key." }
  }

  const keepDays = parseInt(String(keepDaysRaw), 10)
  // 0 = keep forever; otherwise minimum is 30
  if (!Number.isFinite(keepDays) || (keepDays !== 0 && keepDays < 30)) {
    return { ok: false, error: "Keep days must be 0 (forever) or at least 30." }
  }
  // Audit-log retention has a compliance floor: 7 years, raisable, never
  // lower (also enforced by the retention_settings_audit_floor CHECK and
  // clamped inside both purge functions — migration 212).
  if (moduleKey.trim() === "audit_logs" && keepDays !== 0 && keepDays < 2555) {
    return {
      ok: false,
      error:
        "Audit log retention cannot be set below 7 years (2555 days). Use 0 to keep forever.",
    }
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

/**
 * Manually triggers the purge function for a specific module.
 * Calls the DB-level purge function defined in migration 24.
 */
/**
 * Two-person audit-log destruction (migration 213). The first approval marks
 * the batch; a second approval by a DIFFERENT admin performs the delete. The
 * RPC enforces the admin gate, the distinct-approver rule, and self-audits.
 */
export async function approveAuditDestruction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const res = await resolveFacility()
  if (!res.ok) return { ok: false, error: res.error }

  const batchId = formData.get("batch_id")
  if (typeof batchId !== "string" || !batchId.trim()) {
    return { ok: false, error: "Batch id required." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("approve_audit_destruction", {
    p_batch_id: batchId.trim(),
  })
  if (error) return { ok: false, error: error.message }

  const result = (data ?? {}) as { ok?: boolean; error?: string; state?: string; destroyed_count?: number }
  if (result.ok !== true) {
    return { ok: false, error: result.error ?? "Approval failed." }
  }

  revalidatePath("/admin/retention")
  if (result.state === "destroyed") {
    const n = result.destroyed_count ?? 0
    return {
      ok: true,
      message: `Second approval recorded — batch destroyed (${n} record${n === 1 ? "" : "s"}).`,
    }
  }
  return {
    ok: true,
    message:
      "First approval recorded. A different admin must approve before anything is destroyed.",
  }
}

/** Cancel a staged destruction batch: restores every row to the audit log. */
export async function cancelAuditDestruction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const res = await resolveFacility()
  if (!res.ok) return { ok: false, error: res.error }

  const batchId = formData.get("batch_id")
  if (typeof batchId !== "string" || !batchId.trim()) {
    return { ok: false, error: "Batch id required." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("cancel_audit_destruction", {
    p_batch_id: batchId.trim(),
  })
  if (error) return { ok: false, error: error.message }

  const result = (data ?? {}) as { ok?: boolean; error?: string; restored_count?: number }
  if (result.ok !== true) {
    return { ok: false, error: result.error ?? "Cancel failed." }
  }

  revalidatePath("/admin/retention")
  const n = result.restored_count ?? 0
  return {
    ok: true,
    message: `Batch cancelled — ${n} record${n === 1 ? "" : "s"} restored to the audit log.`,
  }
}

export async function triggerManualPurge(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const res = await resolveFacility()
  if (!res.ok) return { ok: false, error: res.error }
  const { facilityId } = res

  const moduleKey = formData.get("module_key")
  if (typeof moduleKey !== "string" || !KNOWN_MODULE_KEYS.has(moduleKey.trim())) {
    return { ok: false, error: "Invalid module key." }
  }

  const supabase = await createClient()

  const { data, error } = await supabase.rpc("purge_module_data", {
    p_facility_id: facilityId,
    p_module_key: moduleKey.trim(),
  })

  if (error) {
    return { ok: false, error: error.message || "Purge failed." }
  }

  const deletedCount = typeof data === "number" ? data : 0

  // Record last purge timestamp and count.
  await supabase
    .from("retention_settings")
    .update({
      last_purged_at: new Date().toISOString(),
      last_purge_count: deletedCount,
    })
    .eq("facility_id", facilityId)
    .eq("module_key", moduleKey.trim())

  revalidatePath("/admin/retention")
  return {
    ok: true,
    message: deletedCount > 0
      ? `Purge complete. ${deletedCount} record${deletedCount === 1 ? "" : "s"} deleted.`
      : "Purge complete. No records older than the threshold were found.",
  }
}
