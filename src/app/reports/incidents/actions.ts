"use server"

import { redirect } from "next/navigation"

import { requireUser } from "@/lib/auth"
import { dispatchRulesForSubmission } from "@/lib/notifications/dispatch"
import { createClient } from "@/lib/supabase/server"

export type SubmissionFormState = {
  error?: string
}

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

type SubmissionResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string }

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

  if (!reporterName) {
    return { ok: false, error: "Please enter your name." }
  }
  if (!reporterPhone) {
    return { ok: false, error: "Please enter a phone number." }
  }
  if (!description) {
    return { ok: false, error: "Please describe what happened." }
  }
  if (!incidentTypeId) {
    return { ok: false, error: "Please pick an incident type." }
  }
  if (!severityLevelId) {
    return { ok: false, error: "Please pick a severity level." }
  }
  if (!occurredAtRaw) {
    return { ok: false, error: "Please choose when the incident happened." }
  }

  // Validate the datetime-local string without a timezone round-trip.
  // Appending "Z" just for validation; the raw value is passed to Postgres
  // as-is so no server-timezone offset is applied.
  if (Number.isNaN(new Date(occurredAtRaw + "Z").getTime())) {
    return { ok: false, error: "Invalid date and time." }
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
    return { error: result.error }
  }
  redirect(result.redirectTo)
}
