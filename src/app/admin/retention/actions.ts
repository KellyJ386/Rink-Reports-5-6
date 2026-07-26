"use server"

import { revalidatePath } from "next/cache"

import { logAudit } from "@/lib/audit/log"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import type { ActionState } from "./types"
import { MODULES } from "./types"

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  if (err.code === "23505") return "A retention rule for this module already exists."
  // 23514 is raised by retention_settings_enforce_floor() (migration 208) when a
  // value falls below the module's regulatory floor. Its message already names
  // the module and both day counts, so surface it verbatim rather than
  // flattening it into a generic error.
  if (err.code === "23514" && err.message?.includes("regulatory minimum")) {
    return err.message.trim()
  }
  return err.message?.trim() || fallback
}

async function resolveFacility(): Promise<
  { ok: true; facilityId: string } | { ok: false; error: string }
> {
  const { profile } = await requireAdmin()
  if (!profile?.facility_id) return { ok: false, error: "No facility assigned." }
  return { ok: true, facilityId: profile.facility_id }
}

// Derived from the single MODULES list rather than kept as a second hardcoded
// copy — the two drifted apart previously (this set still listed audit_logs and
// scheduling after both stopped being retention-configurable).
const KNOWN_MODULE_KEYS = new Set(MODULES.map((m) => m.key))

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
  // Basic sanity only. The authoritative per-module floor lives in
  // retention_module_floors and is enforced by a BEFORE INSERT/UPDATE trigger
  // (migration 208) — deliberately NOT duplicated here. The floor used to exist
  // only as a browser-side `minDays` prop, which meant a crafted POST could set
  // accident_reports to 30 days and then hard-delete against it.
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

  const key = moduleKey.trim()
  const supabase = await createClient()

  const { data: before } = await supabase
    .from("retention_settings")
    .select("keep_days, auto_purge")
    .eq("facility_id", facilityId)
    .eq("module_key", key)
    .maybeSingle()

  const { data: saved, error } = await supabase
    .from("retention_settings")
    .upsert(
      {
        facility_id: facilityId,
        module_key: key,
        keep_days: keepDays,
        auto_purge: autoPurge,
      },
      { onConflict: "facility_id,module_key" },
    )
    .select("keep_days, auto_purge")
    .maybeSingle()

  if (error) return { ok: false, error: dbError(error, "Failed to save retention setting.") }

  // Changing how long compliance records survive is itself a compliance-relevant
  // act; until now it left no trace at all.
  await logAudit({
    facilityId,
    action: "retention.setting_updated",
    entityType: "retention_settings",
    entityId: key,
    before: before ?? null,
    after: saved ?? { keep_days: keepDays, auto_purge: autoPurge },
  })

  revalidatePath("/admin/retention")

  // keep_days = 0 means "keep forever", which the trigger resolves by forcing
  // auto_purge off. Say so rather than letting the checkbox silently flip back.
  if (keepDays === 0 && autoPurge) {
    return {
      ok: true,
      message: "Saved. Auto-purge was turned off because records are kept forever.",
    }
  }
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

  // The irreversible one. purge_module_data ignores auto_purge, so this button
  // deletes on the spot — it must leave a record even when it deletes nothing.
  await logAudit({
    facilityId,
    action: "retention.manual_purge",
    entityType: "retention_settings",
    entityId: moduleKey.trim(),
    after: { module_key: moduleKey.trim(), deleted_count: deletedCount },
  })

  revalidatePath("/admin/retention")
  return {
    ok: true,
    message: deletedCount > 0
      ? `Purge complete. ${deletedCount} record${deletedCount === 1 ? "" : "s"} deleted.`
      : "Purge complete. No records older than the threshold were found.",
  }
}
