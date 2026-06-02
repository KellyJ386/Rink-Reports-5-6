"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { requireUser } from "@/lib/auth"
import { dispatchRulesForSubmission } from "@/lib/notifications/dispatch"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"

// Names match form input `name` attributes — keep them in sync with the
// submission-form component. Witnesses / spaces surface as a top-level error
// (they aren't single inputs), so they're not in this union.
export type IncidentFieldName =
  | "reporter_name"
  | "reporter_phone"
  | "occurred_at"
  | "severity_level_id"
  | "description"

export type SubmissionFormState = {
  // Top-level error (server failure, auth, permission, spaces/witnesses).
  error?: string
  // Per-field validation errors, rendered next to each input.
  fieldErrors?: Partial<Record<IncidentFieldName, string>>
}

type SupabaseError = { code?: string; message?: string } | null

const DESCRIPTION_MAX = 500
const MAX_WITNESSES = 3

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

type WitnessInput = {
  name: string
  phone: string | null
  email: string | null
  statement: string | null
}

type IncidentFields = {
  reporter_name: string
  reporter_phone: string
  description: string
  occurred_at: string
  severity_level_id: string
  activity_id: string
  activity_other: string
  location_other: string
  immediate_actions: string
  space_ids: string[]
  witnesses: WitnessInput[]
  witnessMissingContact: boolean
}

/**
 * Parse the witnesses hidden input. Only entries with a name are kept. Sets
 * `missingContact` if any named entry lacks both phone and email.
 */
function parseWitnesses(raw: string): {
  rows: WitnessInput[]
  missingContact: boolean
} {
  if (!raw.trim()) return { rows: [], missingContact: false }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { rows: [], missingContact: false }
  }
  if (!Array.isArray(parsed)) return { rows: [], missingContact: false }
  const rows: WitnessInput[] = []
  let missingContact = false
  for (const item of parsed) {
    if (rows.length >= MAX_WITNESSES) break
    if (!item || typeof item !== "object") continue
    const obj = item as Record<string, unknown>
    const name = typeof obj.name === "string" ? obj.name.trim() : ""
    if (!name) continue
    const phone = typeof obj.phone === "string" ? obj.phone.trim() : ""
    const email = typeof obj.email === "string" ? obj.email.trim() : ""
    const statement =
      typeof obj.statement === "string" ? obj.statement.trim() : ""
    if (!phone && !email) {
      missingContact = true
      continue
    }
    rows.push({
      name,
      phone: phone || null,
      email: email || null,
      statement: statement || null,
    })
  }
  return { rows, missingContact }
}

/** Parse the selected facility-space ids hidden input. */
function parseSpaceIds(raw: string): string[] {
  if (!raw.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out = new Set<string>()
  for (const item of parsed) {
    if (typeof item === "string" && item.trim().length > 0) out.add(item.trim())
  }
  return Array.from(out)
}

function readFields(formData: FormData): IncidentFields {
  const get = (k: string) => String(formData.get(k) ?? "").trim()
  const { rows: witnesses, missingContact } = parseWitnesses(
    String(formData.get("witnesses_json") ?? ""),
  )
  return {
    reporter_name: get("reporter_name"),
    reporter_phone: get("reporter_phone"),
    description: get("description"),
    occurred_at: get("occurred_at"),
    severity_level_id: get("severity_level_id"),
    activity_id: get("activity_id"),
    activity_other: get("activity_other"),
    location_other: get("location_other"),
    immediate_actions: get("immediate_actions"),
    space_ids: parseSpaceIds(String(formData.get("spaces_json") ?? "")),
    witnesses,
    witnessMissingContact: missingContact,
  }
}

// Collect per-field validation errors. Insertion order drives the form's
// auto-focus, so it follows the visual order of the inputs.
function validateFields(
  fields: IncidentFields,
): Partial<Record<IncidentFieldName, string>> {
  const errors: Partial<Record<IncidentFieldName, string>> = {}
  if (!fields.reporter_name) errors.reporter_name = "Please enter your name."
  if (!fields.reporter_phone)
    errors.reporter_phone = "Please enter a phone number."
  if (!fields.occurred_at) {
    errors.occurred_at = "Please choose when the incident happened."
  } else if (Number.isNaN(new Date(fields.occurred_at).getTime())) {
    errors.occurred_at = "Invalid date and time."
  }
  if (!fields.severity_level_id)
    errors.severity_level_id = "Please pick a severity level."
  if (!fields.description) {
    errors.description = "Please describe what happened."
  } else if (fields.description.length > DESCRIPTION_MAX) {
    errors.description = `Description must be ${DESCRIPTION_MAX} characters or fewer.`
  }
  return errors
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

type ResolvedRefs =
  | { ok: true; resolvedActivityId: string | null; validSpaceIds: string[] }
  | { ok: false; error: string }

/**
 * Confirm severity / activity / spaces all belong to this facility (and are
 * active), and enforce the "at least one space or an Other" requirement.
 */
async function resolveFacilityRefs(
  supabase: SupabaseClient,
  facilityId: string,
  fields: IncidentFields,
): Promise<ResolvedRefs> {
  const { data: severity } = await supabase
    .from("incident_severity_levels")
    .select("id, is_active")
    .eq("id", fields.severity_level_id)
    .eq("facility_id", facilityId)
    .maybeSingle()
  if (!severity || !severity.is_active) {
    return { ok: false, error: "Selected severity level is not available." }
  }

  let resolvedActivityId: string | null = null
  if (fields.activity_id) {
    const { data: activity } = await supabase
      .from("incident_activities")
      .select("id, is_active")
      .eq("id", fields.activity_id)
      .eq("facility_id", facilityId)
      .maybeSingle()
    if (!activity || !activity.is_active) {
      return { ok: false, error: "Selected activity is not available." }
    }
    resolvedActivityId = activity.id
  }

  let validSpaceIds: string[] = []
  if (fields.space_ids.length > 0) {
    const { data: spaceRows } = await supabase
      .from("facility_spaces")
      .select("id")
      .in("id", fields.space_ids)
      .eq("facility_id", facilityId)
      .eq("is_active", true)
    validSpaceIds = (spaceRows ?? []).map((s) => s.id)
  }
  if (validSpaceIds.length === 0 && !fields.location_other) {
    return {
      ok: false,
      error: "Please choose at least one facility space (or add an “Other”).",
    }
  }

  return { ok: true, resolvedActivityId, validSpaceIds }
}

function witnessRowsFor(
  facilityId: string,
  incidentId: string,
  witnesses: WitnessInput[],
) {
  return witnesses.map((w, i) => ({
    incident_id: incidentId,
    facility_id: facilityId,
    name: w.name,
    phone: w.phone,
    email: w.email,
    statement: w.statement,
    sort_order: i,
  }))
}

// =============================================================================
// Submit
// =============================================================================

type SubmissionResult =
  | { ok: true; redirectTo: string }
  | {
      ok: false
      error?: string
      fieldErrors?: Partial<Record<IncidentFieldName, string>>
    }

async function performSubmit(formData: FormData): Promise<SubmissionResult> {
  const current = await requireUser()
  const supabase = await createClient()

  const fields = readFields(formData)
  const fieldErrors = validateFields(fields)
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors }
  if (fields.witnessMissingContact) {
    return {
      ok: false,
      error:
        "Each witness needs a name and at least one contact (phone or email).",
    }
  }

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

  if (!(await currentUserCan(supabase, "incident_reports", "submit"))) {
    return {
      ok: false,
      error: "You don't have permission to submit incident reports.",
    }
  }

  const facilityId = employeeRow.facility_id
  const refs = await resolveFacilityRefs(supabase, facilityId, fields)
  if (!refs.ok) return { ok: false, error: refs.error }

  const occurredAtIso = new Date(fields.occurred_at).toISOString()
  const activityOther = refs.resolvedActivityId
    ? null
    : fields.activity_other || null

  const { data: inserted, error: insertErr } = await supabase
    .from("incident_reports")
    .insert({
      facility_id: facilityId,
      employee_id: employeeRow.id,
      severity_level_id: fields.severity_level_id,
      activity_id: refs.resolvedActivityId,
      activity_other: activityOther,
      location_other: fields.location_other || null,
      immediate_actions: fields.immediate_actions || null,
      occurred_at: occurredAtIso,
      reporter_name: fields.reporter_name,
      reporter_phone: fields.reporter_phone,
      description: fields.description,
      status: "submitted",
      submitted_at: new Date().toISOString(),
    })
    .select("id, submitted_at, occurred_at, edit_window_ends_at")
    .single()

  if (insertErr || !inserted) {
    return {
      ok: false,
      error: dbError(insertErr, "Failed to submit incident report."),
    }
  }

  const reportId = inserted.id

  // Best-effort cleanup wrapper — if a child insert fails, remove the parent so
  // the submitter can retry cleanly (mirrors the accidents flow).
  const cleanupAndFail = async (msg: string): Promise<SubmissionResult> => {
    await supabase.from("incident_reports").delete().eq("id", reportId)
    return { ok: false, error: msg }
  }

  if (refs.validSpaceIds.length > 0) {
    const spaceRows = refs.validSpaceIds.map((space_id) => ({
      incident_id: reportId,
      facility_id: facilityId,
      space_id,
    }))
    const { error: spErr } = await supabase
      .from("incident_report_spaces")
      .insert(spaceRows)
    if (spErr) {
      return cleanupAndFail(dbError(spErr, "Failed to save facility spaces."))
    }
  }

  if (fields.witnesses.length > 0) {
    const { error: wErr } = await supabase
      .from("incident_witnesses")
      .insert(witnessRowsFor(facilityId, reportId, fields.witnesses))
    if (wErr) {
      return cleanupAndFail(dbError(wErr, "Failed to save witnesses."))
    }
  }

  const { error: logErr } = await supabase.from("incident_change_log").insert({
    incident_id: reportId,
    facility_id: facilityId,
    employee_id: employeeRow.id,
    action: "create",
    before: null,
    after: {
      id: reportId,
      severity_level_id: fields.severity_level_id,
      activity_id: refs.resolvedActivityId,
      activity_other: activityOther,
      location_other: fields.location_other || null,
      immediate_actions: fields.immediate_actions || null,
      occurred_at: inserted.occurred_at,
      submitted_at: inserted.submitted_at,
      edit_window_ends_at: inserted.edit_window_ends_at,
      reporter_name: fields.reporter_name,
      reporter_phone: fields.reporter_phone,
      description: fields.description,
      space_ids: refs.validSpaceIds,
      witnesses: fields.witnesses,
    },
  })
  if (logErr) {
    return cleanupAndFail(dbError(logErr, "Failed to record change log."))
  }

  await dispatchRulesForSubmission({
    facilityId,
    sourceModule: "incident_reports",
    sourceRecordId: reportId,
    subject: `Incident report submitted by ${fields.reporter_name}`,
    body: fields.description,
  })

  return { ok: true, redirectTo: `/reports/incidents/done?id=${reportId}` }
}

export async function submitIncidentReport(
  _prev: SubmissionFormState,
  formData: FormData,
): Promise<SubmissionFormState> {
  const result = await performSubmit(formData)
  if (!result.ok) {
    return { error: result.error, fieldErrors: result.fieldErrors }
  }
  redirect(result.redirectTo)
}

// =============================================================================
// Update (submitter, within the 24h edit window)
// =============================================================================

export async function updateIncidentReport(
  reportId: string,
  _prev: SubmissionFormState,
  formData: FormData,
): Promise<SubmissionFormState> {
  const current = await requireUser()
  const supabase = await createClient()

  const fields = readFields(formData)
  const fieldErrors = validateFields(fields)
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }
  if (fields.witnessMissingContact) {
    return {
      error:
        "Each witness needs a name and at least one contact (phone or email).",
    }
  }

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()
  if (!employeeRow) {
    return {
      error: "Your account isn't fully set up yet. Contact your administrator.",
    }
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("incident_reports")
    .select(
      "id, facility_id, employee_id, edit_window_ends_at, severity_level_id, activity_id, activity_other, location_other, immediate_actions, occurred_at, submitted_at, reporter_name, reporter_phone, description",
    )
    .eq("id", reportId)
    .maybeSingle()

  if (fetchErr || !existing) return { error: "Report not found." }
  if (existing.employee_id !== employeeRow.id) {
    return { error: "You can only edit your own reports." }
  }
  if (new Date(existing.edit_window_ends_at).getTime() <= Date.now()) {
    return { error: "The edit window for this report has closed." }
  }

  const facilityId = existing.facility_id
  const refs = await resolveFacilityRefs(supabase, facilityId, fields)
  if (!refs.ok) return { error: refs.error }

  // Snapshot existing children for the before-state.
  const [{ data: existingSpaceRows }, { data: existingWitnessRows }] =
    await Promise.all([
      supabase
        .from("incident_report_spaces")
        .select("space_id")
        .eq("incident_id", reportId),
      supabase
        .from("incident_witnesses")
        .select("name, phone, email, statement")
        .eq("incident_id", reportId)
        .order("sort_order", { ascending: true }),
    ])

  const occurredAtIso = new Date(fields.occurred_at).toISOString()
  const activityOther = refs.resolvedActivityId
    ? null
    : fields.activity_other || null

  const { error: updErr } = await supabase
    .from("incident_reports")
    .update({
      severity_level_id: fields.severity_level_id,
      activity_id: refs.resolvedActivityId,
      activity_other: activityOther,
      location_other: fields.location_other || null,
      immediate_actions: fields.immediate_actions || null,
      occurred_at: occurredAtIso,
      reporter_name: fields.reporter_name,
      reporter_phone: fields.reporter_phone,
      description: fields.description,
    })
    .eq("id", reportId)
  if (updErr) {
    return { error: dbError(updErr, "Failed to update report.") }
  }

  // Reconcile spaces by full replace (small row count, simplest correct path).
  const { error: delSpacesErr } = await supabase
    .from("incident_report_spaces")
    .delete()
    .eq("incident_id", reportId)
  if (delSpacesErr) {
    return { error: dbError(delSpacesErr, "Failed to update facility spaces.") }
  }
  if (refs.validSpaceIds.length > 0) {
    const { error: insSpacesErr } = await supabase
      .from("incident_report_spaces")
      .insert(
        refs.validSpaceIds.map((space_id) => ({
          incident_id: reportId,
          facility_id: facilityId,
          space_id,
        })),
      )
    if (insSpacesErr) {
      return {
        error: dbError(insSpacesErr, "Failed to update facility spaces."),
      }
    }
  }

  // Reconcile witnesses by full replace.
  const { error: delWitErr } = await supabase
    .from("incident_witnesses")
    .delete()
    .eq("incident_id", reportId)
  if (delWitErr) {
    return { error: dbError(delWitErr, "Failed to update witnesses.") }
  }
  if (fields.witnesses.length > 0) {
    const { error: insWitErr } = await supabase
      .from("incident_witnesses")
      .insert(witnessRowsFor(facilityId, reportId, fields.witnesses))
    if (insWitErr) {
      return { error: dbError(insWitErr, "Failed to update witnesses.") }
    }
  }

  await supabase.from("incident_change_log").insert({
    incident_id: reportId,
    facility_id: facilityId,
    employee_id: employeeRow.id,
    action: "update",
    before: {
      severity_level_id: existing.severity_level_id,
      activity_id: existing.activity_id,
      activity_other: existing.activity_other,
      location_other: existing.location_other,
      immediate_actions: existing.immediate_actions,
      occurred_at: existing.occurred_at,
      reporter_name: existing.reporter_name,
      reporter_phone: existing.reporter_phone,
      description: existing.description,
      space_ids: (existingSpaceRows ?? []).map((s) => s.space_id),
      witnesses: existingWitnessRows ?? [],
    },
    after: {
      severity_level_id: fields.severity_level_id,
      activity_id: refs.resolvedActivityId,
      activity_other: activityOther,
      location_other: fields.location_other || null,
      immediate_actions: fields.immediate_actions || null,
      occurred_at: occurredAtIso,
      reporter_name: fields.reporter_name,
      reporter_phone: fields.reporter_phone,
      description: fields.description,
      space_ids: refs.validSpaceIds,
      witnesses: fields.witnesses,
    },
  })

  revalidatePath(`/reports/incidents/${reportId}`)
  redirect(`/reports/incidents/${reportId}?saved=1`)
}
