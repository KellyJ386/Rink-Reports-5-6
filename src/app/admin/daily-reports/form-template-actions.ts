"use server"

// Admin server actions for the Daily Reports form builder (migration 235):
// form-template CRUD with publish-as-new-version semantics, plus the
// end-of-day lock/unlock for report instances.
//
// VERSIONING RULE (the whole point of the design): editing a template's
// fields NEVER mutates the published version — publishFormTemplateVersion
// inserts a NEW row (version + 1, supersedes_id → old) with a fresh field
// set, then stamps the old row superseded. Existing instances are unaffected
// either way: they render from their frozen template_snapshot. The partial
// unique index uniq_daily_report_form_templates_supersedes serializes
// concurrent publishes of the same template (the loser gets a 23505).
//
// facility_id is ALWAYS resolved from the session profile — never accepted
// from the client.

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { logServerError } from "@/lib/observability/log-server-error"
import { currentUserCan } from "@/lib/permissions/check"
import { createClient } from "@/lib/supabase/server"
import type { Json } from "@/types/database"

import {
  parseFieldDefs,
  type FieldDefInput,
} from "@/app/reports/daily/_lib/instance-compute"
import { businessDateInTimeZone } from "@/app/reports/daily/_lib/compute"

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  if (err.code === "23505") {
    return "That change conflicts with a concurrent edit. Reload and try again."
  }
  if (err.code === "23503") {
    return "Cannot complete: a related record prevents this change."
  }
  return err.message?.trim() || fallback
}

export type TemplateActionResult =
  | { ok: true; templateId: string; version: number }
  | { ok: false; error: string }

export type SimpleResult = { ok: true } | { ok: false; error: string }

/**
 * Same guard as the sibling actions.ts: requireAdmin() covers console access,
 * but the RLS write policies gate on has_module_admin_access('daily_reports')
 * — a module-scoped grant requireAdmin does not imply.
 */
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

/** The acting employee row (for created_by / locked_by attribution). */
async function resolveEmployeeId(facilityId: string): Promise<string | null> {
  const current = await getCurrentUser()
  if (!current?.profile?.id) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", current.profile.id)
    .eq("facility_id", facilityId)
    .maybeSingle()
  return data?.id ?? null
}

function fieldInsertRows(
  facilityId: string,
  templateId: string,
  fields: FieldDefInput[],
) {
  return fields.map((f, i) => ({
    facility_id: facilityId,
    template_id: templateId,
    label: f.label,
    field_type: f.field_type,
    options: (f.options as unknown as Json) ?? null,
    required: f.required,
    sort_order: i,
  }))
}

// ============================================================================
// Templates
// ============================================================================

/**
 * Create a new form template (version 1) with its field list. The template +
 * fields are two REST writes; on a field failure the template row is deleted
 * (cascade clears any partial fields) — same documented best-effort rollback
 * as the legacy submit pipeline.
 */
export async function createFormTemplate(input: {
  areaId: string
  name: string
  fields: unknown
}): Promise<TemplateActionResult> {
  try {
    const denied = await ensureDailyAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const name = typeof input?.name === "string" ? input.name.trim() : ""
    if (!name) return { ok: false, error: "Name is required." }
    if (!input?.areaId) return { ok: false, error: "Area is required." }

    const parsed = parseFieldDefs(input.fields)
    if (!parsed.ok) return { ok: false, error: parsed.error }

    const supabase = await createClient()

    const { data: area } = await supabase
      .from("daily_report_areas")
      .select("id")
      .eq("id", input.areaId)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    if (!area) return { ok: false, error: "Area not found." }

    const createdBy = await resolveEmployeeId(facility.facilityId)

    const { data: template, error: tplErr } = await supabase
      .from("daily_report_form_templates")
      .insert({
        facility_id: facility.facilityId,
        area_id: input.areaId,
        name,
        version: 1,
        created_by: createdBy,
      })
      .select("id, version")
      .single()
    if (tplErr || !template) {
      return { ok: false, error: dbError(tplErr, "Failed to create the form.") }
    }

    const { error: fieldsErr } = await supabase
      .from("daily_report_form_fields")
      .insert(fieldInsertRows(facility.facilityId, template.id, parsed.fields))
    if (fieldsErr) {
      await supabase
        .from("daily_report_form_templates")
        .delete()
        .eq("id", template.id)
      return { ok: false, error: dbError(fieldsErr, "Failed to save the fields.") }
    }

    revalidatePath("/admin/daily-reports")
    return { ok: true, templateId: template.id, version: template.version }
  } catch (e) {
    logServerError("admin/daily-reports/form-template-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/**
 * Publish an edited template as a NEW version. The old row is never mutated
 * beyond its superseded stamps; instances created from it keep rendering
 * from their own snapshots. Only the current head of a version chain can be
 * published from — a concurrent publish loses on the supersedes unique index.
 */
export async function publishFormTemplateVersion(input: {
  templateId: string
  name?: string
  fields: unknown
}): Promise<TemplateActionResult> {
  try {
    const denied = await ensureDailyAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!input?.templateId) return { ok: false, error: "Missing template id." }

    const parsed = parseFieldDefs(input.fields)
    if (!parsed.ok) return { ok: false, error: parsed.error }

    const supabase = await createClient()

    const { data: old } = await supabase
      .from("daily_report_form_templates")
      .select("id, area_id, name, version, is_active, superseded_at")
      .eq("id", input.templateId)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    if (!old) return { ok: false, error: "Template not found." }
    if (old.superseded_at !== null) {
      return {
        ok: false,
        error:
          "This version was already superseded. Edit the current version instead.",
      }
    }

    const name =
      typeof input.name === "string" && input.name.trim().length > 0
        ? input.name.trim()
        : old.name

    const createdBy = await resolveEmployeeId(facility.facilityId)

    const { data: next, error: nextErr } = await supabase
      .from("daily_report_form_templates")
      .insert({
        facility_id: facility.facilityId,
        area_id: old.area_id,
        name,
        version: old.version + 1,
        supersedes_id: old.id,
        is_active: old.is_active,
        created_by: createdBy,
      })
      .select("id, version")
      .single()
    if (nextErr || !next) {
      if (nextErr?.code === "23505") {
        return {
          ok: false,
          error: "Someone else just published a new version. Reload and re-apply your changes.",
        }
      }
      return { ok: false, error: dbError(nextErr, "Failed to publish the new version.") }
    }

    const { error: fieldsErr } = await supabase
      .from("daily_report_form_fields")
      .insert(fieldInsertRows(facility.facilityId, next.id, parsed.fields))
    if (fieldsErr) {
      await supabase
        .from("daily_report_form_templates")
        .delete()
        .eq("id", next.id)
      return { ok: false, error: dbError(fieldsErr, "Failed to save the fields.") }
    }

    // The line-through: stamp the old version. On failure, unwind the new row
    // so the chain never ends up with two live heads.
    const { data: stamped, error: stampErr } = await supabase
      .from("daily_report_form_templates")
      .update({
        superseded_at: new Date().toISOString(),
        superseded_by: next.id,
      })
      .eq("id", old.id)
      .eq("facility_id", facility.facilityId)
      .is("superseded_at", null)
      .select("id")
    if (stampErr || !stamped || stamped.length === 0) {
      await supabase
        .from("daily_report_form_templates")
        .delete()
        .eq("id", next.id)
      return {
        ok: false,
        error: dbError(stampErr, "Failed to retire the previous version."),
      }
    }

    revalidatePath("/admin/daily-reports")
    return { ok: true, templateId: next.id, version: next.version }
  } catch (e) {
    logServerError("admin/daily-reports/form-template-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/** Show/hide the current version from staff without touching its fields. */
export async function setFormTemplateActive(
  templateId: string,
  isActive: boolean,
): Promise<SimpleResult> {
  try {
    const denied = await ensureDailyAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!templateId) return { ok: false, error: "Missing template id." }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("daily_report_form_templates")
      .update({ is_active: isActive })
      .eq("id", templateId)
      .eq("facility_id", facility.facilityId)
      .select("id")
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update the form.") }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Template not found." }
    }
    revalidatePath("/admin/daily-reports")
    return { ok: true }
  } catch (e) {
    logServerError("admin/daily-reports/form-template-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/**
 * Delete a form template. Only a never-versioned current template (no
 * predecessor, not superseded) with no instances can be deleted — anything
 * with history should be deactivated so the chain and its instances stay
 * auditable. Instance FKs are ON DELETE RESTRICT, so the DB refuses the rest.
 */
export async function deleteFormTemplate(templateId: string): Promise<SimpleResult> {
  try {
    const denied = await ensureDailyAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!templateId) return { ok: false, error: "Missing template id." }
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("daily_report_form_templates")
      .delete()
      .eq("id", templateId)
      .eq("facility_id", facility.facilityId)
      .is("supersedes_id", null)
      .is("superseded_at", null)
      .select("id")
    if (error) {
      if (error.code === "23503") {
        return {
          ok: false,
          error: "Cannot delete a form with existing reports; deactivate it instead.",
        }
      }
      return { ok: false, error: dbError(error, "Failed to delete the form.") }
    }
    if (!data || data.length === 0) {
      return {
        ok: false,
        error:
          "Only an unversioned current form can be deleted; deactivate it instead.",
      }
    }
    revalidatePath("/admin/daily-reports")
    return { ok: true }
  } catch (e) {
    logServerError("admin/daily-reports/form-template-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// End-of-day lock
// ============================================================================

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function facilityToday(
  facilityId: string,
): Promise<string> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("facilities")
    .select("timezone")
    .eq("id", facilityId)
    .maybeSingle()
  return businessDateInTimeZone(new Date(), data?.timezone ?? null)
}

/**
 * Lock a day: from that moment, ALL report instances for (facility, date)
 * reject writes — at the server actions, at RLS, and at the DB trigger.
 * Defaults to today (facility-local). Future days cannot be locked.
 * Idempotent: locking an already-locked day succeeds.
 */
export async function lockReportDay(reportDate?: string): Promise<SimpleResult> {
  try {
    const denied = await ensureDailyAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const today = await facilityToday(facility.facilityId)
    const date = reportDate ?? today
    if (!DATE_RE.test(date)) {
      return { ok: false, error: "Invalid date." }
    }
    if (date > today) {
      return { ok: false, error: "A future day cannot be locked." }
    }

    const lockedBy = await resolveEmployeeId(facility.facilityId)
    const supabase = await createClient()
    const { error } = await supabase.from("daily_report_day_locks").insert({
      facility_id: facility.facilityId,
      report_date: date,
      locked_by: lockedBy,
    })
    if (error && error.code !== "23505") {
      return { ok: false, error: dbError(error, "Failed to lock the day.") }
    }
    revalidatePath("/admin/daily-reports")
    revalidatePath("/reports/daily")
    return { ok: true }
  } catch (e) {
    logServerError("admin/daily-reports/form-template-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/** Unlock a previously-locked day (admin correction path). */
export async function unlockReportDay(reportDate: string): Promise<SimpleResult> {
  try {
    const denied = await ensureDailyAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!reportDate || !DATE_RE.test(reportDate)) {
      return { ok: false, error: "Invalid date." }
    }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("daily_report_day_locks")
      .delete()
      .eq("facility_id", facility.facilityId)
      .eq("report_date", reportDate)
      .select("id")
    if (error) {
      return { ok: false, error: dbError(error, "Failed to unlock the day.") }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "That day isn't locked." }
    }
    revalidatePath("/admin/daily-reports")
    revalidatePath("/reports/daily")
    return { ok: true }
  } catch (e) {
    logServerError("admin/daily-reports/form-template-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}
