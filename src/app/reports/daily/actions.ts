"use server"

import { redirect } from "next/navigation"

import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { buildInputFromForm, persistDaily } from "./_lib/submit"

export type SubmissionFormState = {
  error?: string
}

export type { SubmitItemInput } from "./_lib/compute"

type SubmissionResult =
  | { ok: true; submissionId: string; redirectTo: string }
  | { ok: false; error: string }

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

export type AllowedDailyArea = {
  id: string
  slug: string
  name: string
  color: string | null
}

/**
 * Returns the daily-report areas the current user may SUBMIT to (per-area
 * can_submit in module_area_permissions). Mirrors the server-side RLS boundary
 * (migration 89) for UI use; the DB remains the final authority on writes.
 */
export async function getAllowedDailyAreas(): Promise<AllowedDailyArea[]> {
  const current = await requireUser()
  const supabase = await createClient()

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()
  if (!employeeRow) return []

  const [{ data: areas }, { data: perms }] = await Promise.all([
    supabase
      .from("daily_report_areas")
      .select("id, slug, name, color, sort_order")
      .eq("facility_id", employeeRow.facility_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("module_area_permissions")
      .select("area_id, can_submit")
      .eq("module_key", "daily_reports")
      .eq("employee_id", employeeRow.id),
  ])

  const submittable = new Set(
    (perms ?? []).filter((p) => p.can_submit).map((p) => p.area_id),
  )
  return (areas ?? [])
    .filter((a) => submittable.has(a.id))
    .map((a) => ({ id: a.id, slug: a.slug, name: a.name, color: a.color }))
}

async function performSubmit(
  formData: FormData
): Promise<SubmissionResult> {
  const current = await requireUser()
  const supabase = await createClient()

  // Reconstruct + validate the structured input from the form (same shape the
  // offline replay path parses from its queued payload).
  const built = buildInputFromForm(formData)
  if (!built.ok) {
    return { ok: false, error: built.error }
  }
  const input = built.input

  // Look up the active employee row for this user.
  const { data: employeeRow, error: empErr } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  if (empErr) {
    return { ok: false, error: dbError(empErr, "Failed to load your account.") }
  }
  if (!employeeRow) {
    return {
      ok: false,
      error: "Your account isn't fully set up yet. Contact your administrator.",
    }
  }

  const result = await persistDaily(supabase, {
    employeeId: employeeRow.id,
    facilityId: employeeRow.facility_id,
    input,
  })
  if (!result.ok) {
    return { ok: false, error: result.error }
  }

  return {
    ok: true,
    submissionId: result.reportId,
    redirectTo: `/reports/daily/${input.area_slug}/${input.template_id}/done?id=${result.reportId}`,
  }
}

export async function submitDailyReportAction(
  _prev: SubmissionFormState,
  formData: FormData
): Promise<SubmissionFormState> {
  const result = await performSubmit(formData)
  if (!result.ok) {
    return { error: result.error }
  }
  redirect(result.redirectTo)
}

// ============================================================================
// Corrections (migration 215) — the original submitter's path
// ============================================================================

export type OwnCorrectionItemInput = {
  checklist_item_id: string | null
  label_snapshot: string
  is_checked: boolean
}

/**
 * File a correction for one of YOUR OWN submissions (possibly from a locked
 * past day). The SECURITY DEFINER RPC authorizes (module admin OR original
 * submitter), requires a reason, stamps the original superseded, and keeps
 * both versions on record.
 */
export async function fileOwnCorrection(input: {
  submissionId: string
  reason: string
  items: OwnCorrectionItemInput[]
}): Promise<{ ok: true; correctionId: string } | { ok: false; error: string }> {
  await requireUser()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc(
    "supersede_daily_report_submission",
    {
      p_original_id: input.submissionId,
      p_reason: input.reason,
      p_items: input.items,
    },
  )
  if (error) return { ok: false, error: dbError(error, "Correction failed.") }
  const result = (data ?? {}) as {
    ok?: boolean
    error?: string
    correction_id?: string
  }
  if (result.ok !== true || !result.correction_id) {
    return { ok: false, error: result.error ?? "Correction failed." }
  }
  return { ok: true, correctionId: result.correction_id }
}
