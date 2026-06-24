// Server-only daily-submission pipeline used by BOTH the online server action
// (`../actions.ts`) and the offline replay endpoint (`/api/offline-sync`). Pure
// parsing/validation lives in `compute.ts` (unit-tested); this module adds the
// Supabase + notification I/O so an offline submission lands the same rows, with
// the same checks, as an online one.

import "server-only"

import { dispatchRulesForSubmission } from "@/lib/notifications/dispatch"
import type { createClient } from "@/lib/supabase/server"

import {
  businessDateInTimeZone,
  parseItemsJson,
  type DailyInput,
} from "./compute"

// Re-export the parsers the callers import from here.
export { buildInputFromObject, buildInputFromPayload } from "./compute"
export type { DailyInput, SubmitItemInput } from "./compute"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

type SupabaseError = { code?: string; message?: string } | null
function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

export type BuildFromFormResult =
  | { ok: true; input: DailyInput }
  | { ok: false; error: string }

/**
 * Online path: reconstruct the structured input from the submitted FormData.
 * Returns a user-facing validation error (rather than throwing) when required
 * identifiers are missing or the checklist JSON is malformed.
 */
export function buildInputFromForm(formData: FormData): BuildFromFormResult {
  const template_id = String(formData.get("template_id") ?? "").trim()
  const area_id = String(formData.get("area_id") ?? "").trim()
  const area_slug = String(formData.get("area_slug") ?? "").trim()
  const note = String(formData.get("note") ?? "").trim()

  if (!template_id || !area_id || !area_slug) {
    return { ok: false, error: "Missing required fields." }
  }

  const itemsResult = parseItemsJson(formData.get("items_json"))
  if (!itemsResult.ok) {
    return { ok: false, error: itemsResult.error }
  }

  return {
    ok: true,
    input: { template_id, area_id, area_slug, note, items: itemsResult.items },
  }
}

export type PersistResult =
  | { ok: true; reportId: string }
  | { ok: false; error: string }

/**
 * Full persist: defense-in-depth ref checks (area + template + per-area submit
 * permission scoped to the employee's facility), insert the submission shell,
 * insert the checklist items, insert the optional note, then dispatch
 * notifications. Mirrors the online action's best-effort cleanup-on-failure.
 */
export async function persistDaily(
  supabase: SupabaseClient,
  args: {
    employeeId: string
    facilityId: string
    input: DailyInput
  },
): Promise<PersistResult> {
  const { employeeId, facilityId, input } = args
  const { template_id, area_id, area_slug, note } = input

  // Defense-in-depth: verify the area + template + permission match the
  // employee's facility. RLS is the final gate on the inserts.
  const { data: area } = await supabase
    .from("daily_report_areas")
    .select("id, facility_id, is_active")
    .eq("id", area_id)
    .eq("facility_id", facilityId)
    .maybeSingle()

  if (!area || !area.is_active) {
    return { ok: false, error: "Area not available." }
  }

  const { data: template } = await supabase
    .from("daily_report_templates")
    .select("id, area_id, facility_id, is_active")
    .eq("id", template_id)
    .eq("facility_id", facilityId)
    .eq("area_id", area_id)
    .maybeSingle()

  if (!template || !template.is_active) {
    return { ok: false, error: "Template not available." }
  }

  const { data: perm } = await supabase
    .from("module_area_permissions")
    .select("can_submit")
    .eq("module_key", "daily_reports")
    .eq("employee_id", employeeId)
    .eq("area_id", area_id)
    .maybeSingle()

  if (!perm?.can_submit) {
    return { ok: false, error: "You don't have access to submit here." }
  }

  // Resolve the facility-local business date so a same-day re-submit of this
  // area+template updates the existing report (correction) rather than
  // duplicating it. A new local day always creates a fresh report.
  const { data: facilityRow } = await supabase
    .from("facilities")
    .select("timezone")
    .eq("id", facilityId)
    .maybeSingle()
  const businessDate = businessDateInTimeZone(
    new Date(),
    facilityRow?.timezone ?? null,
  )

  const { data: existing } = await supabase
    .from("daily_report_submissions")
    .select("id")
    .eq("facility_id", facilityId)
    .eq("area_id", area_id)
    .eq("template_id", template_id)
    .eq("business_date", businessDate)
    .maybeSingle()

  const isCorrection = existing != null
  const nowIso = new Date().toISOString()
  let submissionId: string

  // 1. Insert a fresh submission, or update the existing same-day one and clear
  //    its children so this submit fully replaces them (the correction).
  if (existing) {
    const { error: updErr } = await supabase
      .from("daily_report_submissions")
      .update({ employee_id: employeeId, submitted_at: nowIso, updated_at: nowIso })
      .eq("id", existing.id)
      .eq("facility_id", facilityId)
    if (updErr) {
      return { ok: false, error: dbError(updErr, "Failed to update report.") }
    }
    submissionId = existing.id as string
    await supabase
      .from("daily_report_submission_items")
      .delete()
      .eq("submission_id", submissionId)
    // Replace only the staff-authored note; preserve any admin notes.
    await supabase
      .from("daily_report_notes")
      .delete()
      .eq("submission_id", submissionId)
      .eq("is_admin_note", false)
  } else {
    const { data: submission, error: subErr } = await supabase
      .from("daily_report_submissions")
      .insert({
        facility_id: facilityId,
        area_id,
        template_id,
        employee_id: employeeId,
        submitted_at: nowIso,
        business_date: businessDate,
      })
      .select("id")
      .single()
    if (subErr || !submission) {
      return { ok: false, error: dbError(subErr, "Failed to submit report.") }
    }
    submissionId = submission.id as string
  }

  // 2. Insert the items (batch). On failure, best-effort delete the submission
  //    to roll back — Supabase REST has no client-side transactions, so we
  //    accept the small risk that a delete may also fail and leave an orphan
  //    submission with no items. Documented here intentionally.
  if (input.items.length > 0) {
    const itemRows = input.items
      .filter((i) => i.checklist_item_id && i.label_snapshot)
      .map((i) => ({
        facility_id: facilityId,
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
        // Rollback: best-effort delete the submission row — but only when this
        // submit created it. For a correction we must not destroy the original.
        if (!isCorrection) {
          await supabase
            .from("daily_report_submissions")
            .delete()
            .eq("id", submissionId)
        }
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
        facility_id: facilityId,
        submission_id: submissionId,
        employee_id: employeeId,
        is_admin_note: false,
        body: note,
      })
    if (noteErr) {
      // Rollback: best-effort cascade. For a fresh submit we remove the items
      // and the shell; for a correction we leave the (updated) shell intact and
      // only drop this submit's items.
      await supabase
        .from("daily_report_submission_items")
        .delete()
        .eq("submission_id", submissionId)
      if (!isCorrection) {
        await supabase
          .from("daily_report_submissions")
          .delete()
          .eq("id", submissionId)
      }
      return { ok: false, error: dbError(noteErr, "Failed to save note.") }
    }
  }

  await dispatchRulesForSubmission({
    facilityId,
    sourceModule: "daily_reports",
    sourceRecordId: submissionId,
    subject: `Daily report submitted (${area_slug})`,
  })

  return { ok: true, reportId: submissionId }
}
