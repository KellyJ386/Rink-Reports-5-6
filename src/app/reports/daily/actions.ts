"use server"

import { redirect } from "next/navigation"

import { requireUser } from "@/lib/auth"
import { dispatchRulesForSubmission } from "@/lib/notifications/dispatch"
import { createClient } from "@/lib/supabase/server"

export type SubmissionFormState = {
  error?: string
}

export type SubmitItemInput = {
  checklist_item_id: string
  label_snapshot: string
  is_checked: boolean
}

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

  const templateId = String(formData.get("template_id") ?? "").trim()
  const areaId = String(formData.get("area_id") ?? "").trim()
  const areaSlug = String(formData.get("area_slug") ?? "").trim()
  const note = String(formData.get("note") ?? "").trim()

  if (!templateId || !areaId || !areaSlug) {
    return { ok: false, error: "Missing required fields." }
  }

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

  // Defense-in-depth: verify the area + template + permission match the
  // employee's facility. RLS is the final gate on the inserts.
  const { data: area } = await supabase
    .from("daily_report_areas")
    .select("id, facility_id, is_active")
    .eq("id", areaId)
    .eq("facility_id", employeeRow.facility_id)
    .maybeSingle()

  if (!area || !area.is_active) {
    return { ok: false, error: "Area not available." }
  }

  const { data: template } = await supabase
    .from("daily_report_templates")
    .select("id, area_id, facility_id, is_active")
    .eq("id", templateId)
    .eq("facility_id", employeeRow.facility_id)
    .eq("area_id", areaId)
    .maybeSingle()

  if (!template || !template.is_active) {
    return { ok: false, error: "Template not available." }
  }

  const { data: perm } = await supabase
    .from("module_area_permissions")
    .select("can_submit")
    .eq("module_key", "daily_reports")
    .eq("employee_id", employeeRow.id)
    .eq("area_id", areaId)
    .maybeSingle()

  if (!perm?.can_submit) {
    return { ok: false, error: "You don't have access to submit here." }
  }

  // Parse items: form encodes them as JSON in a hidden field.
  const itemsRaw = String(formData.get("items_json") ?? "[]")
  let items: SubmitItemInput[]
  try {
    const parsed = JSON.parse(itemsRaw) as unknown
    if (!Array.isArray(parsed)) throw new Error("not array")
    items = parsed.map((row) => {
      const r = row as Record<string, unknown>
      return {
        checklist_item_id: String(r.checklist_item_id ?? ""),
        label_snapshot: String(r.label_snapshot ?? ""),
        is_checked: Boolean(r.is_checked),
      }
    })
  } catch {
    return { ok: false, error: "Invalid form data." }
  }

  // 1. Insert the submission row.
  const { data: submission, error: subErr } = await supabase
    .from("daily_report_submissions")
    .insert({
      facility_id: employeeRow.facility_id,
      area_id: areaId,
      template_id: templateId,
      employee_id: employeeRow.id,
      submitted_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  if (subErr || !submission) {
    return { ok: false, error: dbError(subErr, "Failed to submit report.") }
  }

  const submissionId = submission.id as string

  // 2. Insert the items (batch). On failure, best-effort delete the submission
  //    to roll back — Supabase REST has no client-side transactions, so we
  //    accept the small risk that a delete may also fail and leave an orphan
  //    submission with no items. Documented here intentionally.
  if (items.length > 0) {
    const itemRows = items
      .filter((i) => i.checklist_item_id && i.label_snapshot)
      .map((i) => ({
        facility_id: employeeRow.facility_id,
        submission_id: submissionId,
        checklist_item_id: i.checklist_item_id,
        label_snapshot: i.label_snapshot,
        is_checked: i.is_checked,
      }))

    if (itemRows.length > 0) {
      const { error: itemErr } = await supabase
        .from("daily_report_submission_items")
        .insert(itemRows)
      if (itemErr) {
        // Rollback: best-effort delete the submission row.
        await supabase
          .from("daily_report_submissions")
          .delete()
          .eq("id", submissionId)
        return {
          ok: false,
          error: dbError(itemErr, "Failed to save checklist items."),
        }
      }
    }
  }

  // 3. Optional note.
  if (note.length > 0) {
    const { error: noteErr } = await supabase
      .from("daily_report_notes")
      .insert({
        facility_id: employeeRow.facility_id,
        submission_id: submissionId,
        employee_id: employeeRow.id,
        is_admin_note: false,
        body: note,
      })
    if (noteErr) {
      // Rollback: best-effort cascade. Items will be removed via FK on submission delete
      // (cascade) if the schema allows; otherwise items remain. We accept this trade-off.
      await supabase
        .from("daily_report_submission_items")
        .delete()
        .eq("submission_id", submissionId)
      await supabase
        .from("daily_report_submissions")
        .delete()
        .eq("id", submissionId)
      return { ok: false, error: dbError(noteErr, "Failed to save note.") }
    }
  }

  await dispatchRulesForSubmission({
    facilityId: employeeRow.facility_id,
    sourceModule: "daily_reports",
    sourceRecordId: submissionId,
    subject: `Daily report submitted (${areaSlug})`,
  })

  return {
    ok: true,
    submissionId,
    redirectTo: `/reports/daily/${areaSlug}/${templateId}/done?id=${submissionId}`,
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
