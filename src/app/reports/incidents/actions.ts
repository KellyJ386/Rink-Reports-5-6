"use server"

import { redirect } from "next/navigation"

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

/**
 * Parse the witnesses hidden input. Only entries with a name are kept. Returns
 * the cleaned rows plus a flag if any started entry is missing a contact, so
 * the action can enforce "name + at least one contact".
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

  const reporterName = String(formData.get("reporter_name") ?? "").trim()
  const reporterPhone = String(formData.get("reporter_phone") ?? "").trim()
  const description = String(formData.get("description") ?? "").trim()
  const occurredAtRaw = String(formData.get("occurred_at") ?? "").trim()
  const severityLevelId = String(formData.get("severity_level_id") ?? "").trim()
  const activityId = String(formData.get("activity_id") ?? "").trim()
  const activityOther = String(formData.get("activity_other") ?? "").trim()
  const locationOther = String(formData.get("location_other") ?? "").trim()
  const immediateActions = String(formData.get("immediate_actions") ?? "").trim()
  const spaceIds = parseSpaceIds(String(formData.get("spaces_json") ?? ""))
  const { rows: witnesses, missingContact } = parseWitnesses(
    String(formData.get("witnesses_json") ?? ""),
  )

  // Per-field validation. Insertion order drives the form's auto-focus, so it
  // follows the visual order of the inputs.
  const fieldErrors: Partial<Record<IncidentFieldName, string>> = {}
  if (!reporterName) fieldErrors.reporter_name = "Please enter your name."
  if (!reporterPhone)
    fieldErrors.reporter_phone = "Please enter a phone number."
  if (!occurredAtRaw) {
    fieldErrors.occurred_at = "Please choose when the incident happened."
  } else if (Number.isNaN(new Date(occurredAtRaw).getTime())) {
    fieldErrors.occurred_at = "Invalid date and time."
  }
  if (!severityLevelId)
    fieldErrors.severity_level_id = "Please pick a severity level."
  if (!description) {
    fieldErrors.description = "Please describe what happened."
  } else if (description.length > DESCRIPTION_MAX) {
    fieldErrors.description = `Description must be ${DESCRIPTION_MAX} characters or fewer.`
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors }
  }

  // Facility space is required: at least one selected space OR an "Other" entry.
  if (spaceIds.length === 0 && !locationOther) {
    return {
      ok: false,
      error: "Please choose at least one facility space (or add an “Other”).",
    }
  }

  if (missingContact) {
    return {
      ok: false,
      error:
        "Each witness needs a name and at least one contact (phone or email).",
    }
  }

  const occurredAtIso = new Date(occurredAtRaw).toISOString()

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

  // Defense-in-depth: confirm submit permission before insert.
  if (!(await currentUserCan(supabase, "incident_reports", "submit"))) {
    return {
      ok: false,
      error: "You don't have permission to submit incident reports.",
    }
  }

  const facilityId = employeeRow.facility_id

  // Severity must belong to this facility and be active.
  const { data: severity } = await supabase
    .from("incident_severity_levels")
    .select("id, is_active")
    .eq("id", severityLevelId)
    .eq("facility_id", facilityId)
    .maybeSingle()
  if (!severity || !severity.is_active) {
    return { ok: false, error: "Selected severity level is not available." }
  }

  // Activity (optional) must belong to this facility and be active.
  let resolvedActivityId: string | null = null
  if (activityId) {
    const { data: activity } = await supabase
      .from("incident_activities")
      .select("id, is_active")
      .eq("id", activityId)
      .eq("facility_id", facilityId)
      .maybeSingle()
    if (!activity || !activity.is_active) {
      return { ok: false, error: "Selected activity is not available." }
    }
    resolvedActivityId = activity.id
  }

  // Validate selected spaces belong to this facility and are active.
  let validSpaceIds: string[] = []
  if (spaceIds.length > 0) {
    const { data: spaceRows } = await supabase
      .from("facility_spaces")
      .select("id")
      .in("id", spaceIds)
      .eq("facility_id", facilityId)
      .eq("is_active", true)
    validSpaceIds = (spaceRows ?? []).map((s) => s.id)
  }
  if (validSpaceIds.length === 0 && !locationOther) {
    return {
      ok: false,
      error: "Please choose at least one facility space (or add an “Other”).",
    }
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("incident_reports")
    .insert({
      facility_id: facilityId,
      employee_id: employeeRow.id,
      severity_level_id: severityLevelId,
      activity_id: resolvedActivityId,
      activity_other: resolvedActivityId ? null : activityOther || null,
      location_other: locationOther || null,
      immediate_actions: immediateActions || null,
      occurred_at: occurredAtIso,
      reporter_name: reporterName,
      reporter_phone: reporterPhone,
      description,
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

  if (validSpaceIds.length > 0) {
    const spaceRows = validSpaceIds.map((space_id) => ({
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

  if (witnesses.length > 0) {
    const witnessRows = witnesses.map((w, i) => ({
      incident_id: reportId,
      facility_id: facilityId,
      name: w.name,
      phone: w.phone,
      email: w.email,
      statement: w.statement,
      sort_order: i,
    }))
    const { error: wErr } = await supabase
      .from("incident_witnesses")
      .insert(witnessRows)
    if (wErr) {
      return cleanupAndFail(dbError(wErr, "Failed to save witnesses."))
    }
  }

  // Append-only audit trail: record the create with a snapshot.
  const { error: logErr } = await supabase.from("incident_change_log").insert({
    incident_id: reportId,
    facility_id: facilityId,
    employee_id: employeeRow.id,
    action: "create",
    before: null,
    after: {
      id: reportId,
      severity_level_id: severityLevelId,
      activity_id: resolvedActivityId,
      activity_other: resolvedActivityId ? null : activityOther || null,
      location_other: locationOther || null,
      immediate_actions: immediateActions || null,
      occurred_at: inserted.occurred_at,
      submitted_at: inserted.submitted_at,
      edit_window_ends_at: inserted.edit_window_ends_at,
      reporter_name: reporterName,
      reporter_phone: reporterPhone,
      description,
      space_ids: validSpaceIds,
      witnesses,
    },
  })
  if (logErr) {
    return cleanupAndFail(dbError(logErr, "Failed to record change log."))
  }

  // Fan out to notification routing rules. Best-effort — never blocks submit.
  await dispatchRulesForSubmission({
    facilityId,
    sourceModule: "incident_reports",
    sourceRecordId: reportId,
    subject: `Incident report submitted by ${reporterName}`,
    body: description,
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
