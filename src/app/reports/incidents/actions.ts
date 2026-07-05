"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { requireUser } from "@/lib/auth"
import { getFacilityTimezone } from "@/lib/facility-timezone"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"
import { wallTimeToUtc } from "@/lib/timezone"

import {
  buildInputFromForm,
  escalateAmbulance,
  persistIncident,
  resolveIncidentRefs,
  resolveReporterIdentity,
  validateIncidentInput,
  witnessesJson,
  type SubmissionFormState,
} from "./_lib/submit"

type SupabaseError = { code?: string; message?: string } | null
function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

// =============================================================================
// Submit (online). The offline path persists the same way via /api/offline-sync
// → persistIncident; both share the helpers in ./_lib/submit.
// =============================================================================

export async function submitIncidentReport(
  _prev: SubmissionFormState,
  formData: FormData,
): Promise<SubmissionFormState> {
  const current = await requireUser()
  const supabase = await createClient()

  const input = buildInputFromForm(formData)
  const { fieldErrors, error } = validateIncidentInput(input)
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }
  if (error) return { error }

  const { data: employeeRow, error: empErr } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  if (empErr) return { error: dbError(empErr, "Failed to load your account.") }
  if (!employeeRow) {
    return {
      error: "Your account isn't fully set up yet. Contact your administrator.",
    }
  }

  if (!(await currentUserCan(supabase, "incident_reports", "submit"))) {
    return { error: "You don't have permission to submit incident reports." }
  }

  // Reporter identity comes from the login, not the form.
  const reporter = await resolveReporterIdentity(supabase, current.authUser.id)
  input.reporter_name = reporter.reporter_name
  input.reporter_phone = reporter.reporter_phone

  const refs = await resolveIncidentRefs(supabase, employeeRow.facility_id, input)
  if (!refs.ok) return { error: refs.error }

  const result = await persistIncident(supabase, {
    employeeId: employeeRow.id,
    facilityId: employeeRow.facility_id,
    input,
    refs,
  })
  if (!result.ok) return { error: result.error }

  redirect(`/reports/incidents/done?id=${result.reportId}`)
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

  const input = buildInputFromForm(formData)
  const { fieldErrors, error } = validateIncidentInput(input)
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }
  if (error) return { error }

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
      "id, facility_id, employee_id, edit_window_ends_at, reporter_name, ambulance_flag",
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
  const refs = await resolveIncidentRefs(supabase, facilityId, input)
  if (!refs.ok) return { error: refs.error }

  // Interpret the reporter's wall clock in the facility timezone → real UTC
  // instant (mirrors persistIncident; migration 174).
  const tz = await getFacilityTimezone(supabase, facilityId)
  const occurredAt = wallTimeToUtc(input.occurred_at, tz)
  if (!occurredAt) {
    return { fieldErrors: { occurred_at: "Invalid date and time." } }
  }
  const occurredAtIso = occurredAt.toISOString()
  const activityOther = refs.resolvedActivityId
    ? null
    : input.activity_other || null

  // Single transaction (migration 173): the report update, the spaces/witness
  // full-replace, and the before/after change-log snapshot land together or
  // not at all. The RLS update policy (owner within the 24h window, or module
  // admin) is the backstop for the friendly pre-checks above; reporter
  // identity is fixed at submission and not part of the update surface.
  const { error: rpcErr } = await supabase.rpc("update_incident_report", {
    p_report_id: reportId,
    p_severity_level_id: input.severity_level_id,
    p_incident_type_id: refs.resolvedIncidentTypeId || undefined,
    p_activity_id: refs.resolvedActivityId ?? undefined,
    p_activity_other: activityOther ?? undefined,
    p_location_other: input.location_other || undefined,
    p_immediate_actions: input.immediate_actions || undefined,
    p_occurred_at: occurredAtIso,
    p_description: input.description,
    p_ambulance_flag: input.ambulance_flag,
    p_persons_involved: input.persons_involved ?? undefined,
    p_follow_up_required: input.follow_up_required,
    p_space_ids: refs.validSpaceIds,
    p_witnesses: witnessesJson(input.witnesses),
  })
  if (rpcErr) return { error: dbError(rpcErr, "Failed to update report.") }

  // An edit that turns the ambulance flag ON is materially new information —
  // raise the same critical escalation the create path would have. (Only on
  // the false → true transition; re-saving an already-flagged report must not
  // re-alert.) Best-effort: never blocks the saved edit.
  if (input.ambulance_flag && !existing.ambulance_flag) {
    await escalateAmbulance(supabase, {
      facilityId,
      employeeId: employeeRow.id,
      reportId,
      reporterName: existing.reporter_name,
      description: input.description,
      phase: "updated",
    })
  }

  revalidatePath(`/reports/incidents/${reportId}`)
  redirect(`/reports/incidents/${reportId}?saved=1`)
}
