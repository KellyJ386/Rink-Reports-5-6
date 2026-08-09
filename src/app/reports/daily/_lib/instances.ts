// Server-only pipeline for Daily Reports form-builder INSTANCES (migration
// 235): create / save / submit a titled report instance. Used by the online
// server actions (`../instance-actions.ts`) and designed for re-use by the
// offline replay endpoint in the offline phase, mirroring the compute.ts /
// submit.ts split of the legacy checklist flow. Pure parsing/validation lives
// in `instance-compute.ts` (unit-tested).
//
// LOCK ENFORCEMENT (the regression this design guards against): the
// end-of-day lock is checked THREE times for every write —
//   1. here, via the daily_report_day_is_locked RPC, so the caller gets an
//      explicit, friendly error;
//   2. in the daily_report_instances RLS policies (WITH CHECK / USING);
//   3. in the trg_daily_report_instances_lock BEFORE trigger.
// Layers 2 and 3 hold even if this module is bypassed entirely. Never make
// this module the only gate.
//
// facility_id is ALWAYS resolved server-side from the caller's employee row —
// none of these functions accept a facility id from client input.

import "server-only"

import type { createClient } from "@/lib/supabase/server"
import type { Json } from "@/types/database"

import { businessDateInTimeZone } from "./compute"
import {
  buildTemplateSnapshot,
  parseSnapshot,
  parseTitle,
  validateResponses,
  type ResponsesMap,
  type TemplateSnapshot,
} from "./instance-compute"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

type SupabaseError = { code?: string; message?: string } | null
function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

function lockedError(reportDate: string): string {
  return `Daily reports for ${reportDate} are locked. No further changes can be made for that day.`
}

/**
 * True when (facility, date) is locked. Uses the SECURITY DEFINER RPC so the
 * answer doesn't depend on the caller's read access to the locks table. Fails
 * CLOSED: an RPC error reports "locked" so a transient failure can't wave a
 * write through to a rejection with a less helpful error.
 */
async function isDayLocked(
  supabase: SupabaseClient,
  facilityId: string,
  reportDate: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("daily_report_day_is_locked", {
    p_facility_id: facilityId,
    p_report_date: reportDate,
  })
  if (error) return true
  return data === true
}

export type InstanceWriteResult =
  | { ok: true; instanceId: string; reportDate: string }
  | { ok: false; error: string }

/**
 * Create a titled instance for today (facility-local). The template's active
 * fields are frozen into template_snapshot at this moment; later template
 * edits never touch this instance. report_date is computed server-side —
 * clients cannot target an arbitrary day.
 */
export async function createInstance(
  supabase: SupabaseClient,
  args: {
    employeeId: string
    facilityId: string
    areaId: string
    templateId: string
    title: unknown
  },
): Promise<InstanceWriteResult> {
  const { employeeId, facilityId, areaId, templateId } = args

  const titleResult = parseTitle(args.title)
  if (!titleResult.ok) return { ok: false, error: titleResult.error }

  // Defense-in-depth ref checks (RLS is the final gate on the insert).
  const { data: area } = await supabase
    .from("daily_report_areas")
    .select("id, is_active")
    .eq("id", areaId)
    .eq("facility_id", facilityId)
    .maybeSingle()
  if (!area || !area.is_active) {
    return { ok: false, error: "Area not available." }
  }

  // Only the CURRENT version of an active template can spawn instances.
  const { data: template } = await supabase
    .from("daily_report_form_templates")
    .select("id, name, version, is_active, superseded_at")
    .eq("id", templateId)
    .eq("facility_id", facilityId)
    .eq("area_id", areaId)
    .maybeSingle()
  if (!template || !template.is_active) {
    return { ok: false, error: "Form template not available." }
  }
  if (template.superseded_at !== null) {
    return {
      ok: false,
      error: "This form has a newer version. Reload and try again.",
    }
  }

  const { data: perm } = await supabase
    .from("module_area_permissions")
    .select("can_submit")
    .eq("module_key", "daily_reports")
    .eq("employee_id", employeeId)
    .eq("area_id", areaId)
    .maybeSingle()
  if (!perm?.can_submit) {
    return { ok: false, error: "You don't have access to submit here." }
  }

  const { data: facilityRow } = await supabase
    .from("facilities")
    .select("timezone")
    .eq("id", facilityId)
    .maybeSingle()
  const reportDate = businessDateInTimeZone(
    new Date(),
    facilityRow?.timezone ?? null,
  )

  if (await isDayLocked(supabase, facilityId, reportDate)) {
    return { ok: false, error: lockedError(reportDate) }
  }

  const { data: fieldRows, error: fieldsErr } = await supabase
    .from("daily_report_form_fields")
    .select("id, label, field_type, options, required, sort_order")
    .eq("template_id", templateId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
  if (fieldsErr) {
    return { ok: false, error: dbError(fieldsErr, "Failed to load the form.") }
  }

  const snapshot = buildTemplateSnapshot(
    { id: template.id, name: template.name, version: template.version },
    fieldRows ?? [],
  )
  if (snapshot.fields.length === 0) {
    return { ok: false, error: "This form has no fields yet." }
  }

  const { data: instance, error: insErr } = await supabase
    .from("daily_report_instances")
    .insert({
      facility_id: facilityId,
      area_id: areaId,
      report_date: reportDate,
      title: titleResult.title,
      template_id: templateId,
      template_snapshot: snapshot as unknown as Json,
      responses: {},
      status: "draft",
      employee_id: employeeId,
    })
    .select("id")
    .single()
  if (insErr || !instance) {
    // The DB trigger raises 42501 with the lock message if the day locked
    // between our check and the insert — surface it as the lock error.
    if (insErr?.code === "42501") {
      return { ok: false, error: lockedError(reportDate) }
    }
    return { ok: false, error: dbError(insErr, "Failed to create the report.") }
  }
  return { ok: true, instanceId: instance.id, reportDate }
}

type LoadedInstance = {
  id: string
  facility_id: string
  area_id: string
  report_date: string
  status: string
  employee_id: string | null
  snapshot: TemplateSnapshot
}

async function loadOwnDraft(
  supabase: SupabaseClient,
  args: { employeeId: string; facilityId: string; instanceId: string },
): Promise<{ ok: true; instance: LoadedInstance } | { ok: false; error: string }> {
  const { data: row, error } = await supabase
    .from("daily_report_instances")
    .select(
      "id, facility_id, area_id, report_date, status, employee_id, template_snapshot",
    )
    .eq("id", args.instanceId)
    .eq("facility_id", args.facilityId)
    .maybeSingle()
  if (error) {
    return { ok: false, error: dbError(error, "Failed to load the report.") }
  }
  if (!row) return { ok: false, error: "Report not found." }
  if (row.employee_id !== args.employeeId) {
    return { ok: false, error: "You can only edit your own reports." }
  }
  if (row.status !== "draft") {
    return {
      ok: false,
      error: "This report was already submitted and can no longer be edited.",
    }
  }
  const snapshot = parseSnapshot(row.template_snapshot)
  if (!snapshot) {
    return { ok: false, error: "This report's stored form is unreadable." }
  }
  return {
    ok: true,
    instance: {
      id: row.id,
      facility_id: row.facility_id,
      area_id: row.area_id,
      report_date: row.report_date,
      status: row.status,
      employee_id: row.employee_id,
      snapshot,
    },
  }
}

/**
 * Save a draft's responses (and optionally retitle it). Partial responses are
 * allowed — required-ness is only enforced at submit. Validation always runs
 * against the instance's FROZEN snapshot, never the live template tables.
 */
export async function saveInstance(
  supabase: SupabaseClient,
  args: {
    employeeId: string
    facilityId: string
    instanceId: string
    responses: unknown
    title?: unknown
  },
): Promise<InstanceWriteResult> {
  const loaded = await loadOwnDraft(supabase, args)
  if (!loaded.ok) return loaded
  const instance = loaded.instance

  if (await isDayLocked(supabase, args.facilityId, instance.report_date)) {
    return { ok: false, error: lockedError(instance.report_date) }
  }

  const validated = validateResponses(instance.snapshot, args.responses, "draft")
  if (!validated.ok) return validated

  const patch: {
    responses: Json
    title?: string
  } = { responses: validated.responses as unknown as Json }
  if (args.title !== undefined) {
    const titleResult = parseTitle(args.title)
    if (!titleResult.ok) return { ok: false, error: titleResult.error }
    patch.title = titleResult.title
  }

  // `.select()` makes a zero-row update detectable (RLS denial — e.g. access
  // revoked or the day locking mid-flight — returns no rows rather than
  // silently succeeding).
  const { data, error } = await supabase
    .from("daily_report_instances")
    .update(patch)
    .eq("id", instance.id)
    .eq("facility_id", args.facilityId)
    .eq("status", "draft")
    .select("id")
  if (error) {
    if (error.code === "42501") {
      return { ok: false, error: lockedError(instance.report_date) }
    }
    return { ok: false, error: dbError(error, "Failed to save the report.") }
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Save was rejected. Reload and try again." }
  }
  return { ok: true, instanceId: instance.id, reportDate: instance.report_date }
}

/**
 * Submit a draft: full validation (required fields included) against the
 * frozen snapshot, then the one-way draft → submitted transition. When
 * `responses` is provided it replaces the stored draft in the same write;
 * omitted, the stored draft responses are validated as-is.
 */
export async function submitInstance(
  supabase: SupabaseClient,
  args: {
    employeeId: string
    facilityId: string
    instanceId: string
    responses?: unknown
  },
): Promise<InstanceWriteResult> {
  const loaded = await loadOwnDraft(supabase, args)
  if (!loaded.ok) return loaded
  const instance = loaded.instance

  if (await isDayLocked(supabase, args.facilityId, instance.report_date)) {
    return { ok: false, error: lockedError(instance.report_date) }
  }

  let responsesInput: unknown = args.responses
  if (responsesInput === undefined) {
    const { data: row } = await supabase
      .from("daily_report_instances")
      .select("responses")
      .eq("id", instance.id)
      .maybeSingle()
    responsesInput = row?.responses ?? {}
  }
  const validated = validateResponses(instance.snapshot, responsesInput, "submit")
  if (!validated.ok) return validated

  const { data, error } = await supabase
    .from("daily_report_instances")
    .update({
      responses: validated.responses as unknown as Json,
      status: "submitted",
      submitted_at: new Date().toISOString(),
    })
    .eq("id", instance.id)
    .eq("facility_id", args.facilityId)
    .eq("status", "draft")
    .select("id")
  if (error) {
    if (error.code === "42501") {
      return { ok: false, error: lockedError(instance.report_date) }
    }
    return { ok: false, error: dbError(error, "Failed to submit the report.") }
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Submit was rejected. Reload and try again." }
  }
  return { ok: true, instanceId: instance.id, reportDate: instance.report_date }
}

export type { ResponsesMap }
