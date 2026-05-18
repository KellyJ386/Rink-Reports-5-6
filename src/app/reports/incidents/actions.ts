"use server"

import { redirect } from "next/navigation"

import { requireUser } from "@/lib/auth"
import { dispatchRulesForSubmission } from "@/lib/notifications/dispatch"
import { createClient } from "@/lib/supabase/server"

// Names match form input `name` attributes — keep them in sync.
export type IncidentFieldName =
  | "reporter_name"
  | "reporter_phone"
  | "description"
  | "incident_type_id"
  | "severity_level_id"
  | "occurred_at"

export type SubmissionFormState = {
  // Top-level error (server failure, auth, permission, RPC). Renders in
  // the form's <FormError> banner.
  error?: string
  // Per-field validation errors. The form renders each one next to its
  // input with aria-describedby so screen readers announce the message
  // when the field gains focus.
  fieldErrors?: Partial<Record<IncidentFieldName, string>>
}

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

type SubmissionResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error?: string; fieldErrors?: Partial<Record<IncidentFieldName, string>> }

async function performSubmit(formData: FormData): Promise<SubmissionResult> {
  const current = await requireUser()
  const supabase = await createClient()

  const reporterName = String(formData.get("reporter_name") ?? "").trim()
  const reporterPhone = String(formData.get("reporter_phone") ?? "").trim()
  const description = String(formData.get("description") ?? "").trim()
  const occurredAtRaw = String(formData.get("occurred_at") ?? "").trim()
  const incidentTypeId = String(formData.get("incident_type_id") ?? "").trim()
  const severityLevelId = String(
    formData.get("severity_level_id") ?? ""
  ).trim()
  const location = String(formData.get("location") ?? "").trim()

  // Collect every field-level error so the user can fix all in one pass.
  // Top-level/global errors (DB, permission, facility mismatch) are
  // returned separately via `error`. Order matters: insertion order
  // determines which field the form will auto-focus, so we follow the
  // visual order of the inputs in the form.
  const fieldErrors: Partial<Record<IncidentFieldName, string>> = {}
  if (!reporterName) fieldErrors.reporter_name = "Please enter your name."
  if (!reporterPhone) fieldErrors.reporter_phone = "Please enter a phone number."
  if (!occurredAtRaw) {
    fieldErrors.occurred_at = "Please choose when the incident happened."
  } else if (Number.isNaN(new Date(occurredAtRaw + "Z").getTime())) {
    // Appending "Z" just for validation; the raw value is passed to Postgres
    // as-is so no server-timezone offset is applied.
    fieldErrors.occurred_at = "Invalid date and time."
  }
  if (!incidentTypeId) fieldErrors.incident_type_id = "Please pick an incident type."
  if (!severityLevelId) fieldErrors.severity_level_id = "Please pick a severity level."
  if (!description) fieldErrors.description = "Please describe what happened."

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors }
  }

  const occurredAtIso = occurredAtRaw.length === 16 ? occurredAtRaw + ":00" : occurredAtRaw

  const { data: employeeRow, error: empErr } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  if (empErr) {
    return {
      ok: false,
      error: dbError(empErr, "Failed to load your account."),
    }
  }
  if (!employeeRow) {
    return {
      ok: false,
      error: "Your account isn't fully set up yet. Contact your administrator.",
    }
  }

  // Defense-in-depth: confirm submit permission before insert.
  const { data: perm } = await supabase
    .from("module_permissions")
    .select("can_submit")
    .eq("module_key", "incident_reports")
    .eq("employee_id", employeeRow.id)
    .maybeSingle()

  if (!perm?.can_submit) {
    return {
      ok: false,
      error: "You don't have permission to submit incident reports.",
    }
  }

  // Verify type + severity belong to the same facility.
  const { data: incidentType } = await supabase
    .from("incident_types")
    .select("id, facility_id, is_active")
    .eq("id", incidentTypeId)
    .eq("facility_id", employeeRow.facility_id)
    .maybeSingle()

  if (!incidentType || !incidentType.is_active) {
    return { ok: false, error: "Selected incident type is not available." }
  }

  const { data: severity } = await supabase
    .from("incident_severity_levels")
    .select("id, facility_id, is_active")
    .eq("id", severityLevelId)
    .eq("facility_id", employeeRow.facility_id)
    .maybeSingle()

  if (!severity || !severity.is_active) {
    return { ok: false, error: "Selected severity level is not available." }
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("incident_reports")
    .insert({
      facility_id: employeeRow.facility_id,
      employee_id: employeeRow.id,
      incident_type_id: incidentTypeId,
      severity_level_id: severityLevelId,
      location: location.length > 0 ? location : null,
      occurred_at: occurredAtIso,
      reporter_name: reporterName,
      reporter_phone: reporterPhone,
      description,
      status: "submitted",
      submitted_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  if (insertErr || !inserted) {
    return {
      ok: false,
      error: dbError(insertErr, "Failed to submit incident report."),
    }
  }

  // Fan out to any matching notification routing rules. Best-effort —
  // dispatch failures must never block a successful submission.
  await dispatchRulesForSubmission({
    facilityId: employeeRow.facility_id,
    sourceModule: "incident_reports",
    sourceRecordId: inserted.id,
    subject: `Incident report submitted by ${reporterName}`,
    body: description,
  })

  return {
    ok: true,
    redirectTo: `/reports/incidents/done?id=${inserted.id}`,
  }
}

export async function submitIncidentReport(
  _prev: SubmissionFormState,
  formData: FormData
): Promise<SubmissionFormState> {
  const result = await performSubmit(formData)
  if (!result.ok) {
    return { error: result.error, fieldErrors: result.fieldErrors }
  }
  redirect(result.redirectTo)
}
