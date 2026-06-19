"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"

import {
  buildInputFromForm,
  persistIncident,
  resolveIncidentRefs,
  resolveReporterIdentity,
  validateIncidentInput,
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
      "id, facility_id, employee_id, edit_window_ends_at, severity_level_id, activity_id, activity_other, location_other, immediate_actions, occurred_at, submitted_at, reporter_name, reporter_phone, description, ambulance_flag, persons_involved, follow_up_required",
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

  // Reporter identity is fixed at submission (from login) and not editable;
  // carry the original values through so the update doesn't blank them.
  input.reporter_name = existing.reporter_name
  input.reporter_phone = existing.reporter_phone ?? ""

  const facilityId = existing.facility_id
  const refs = await resolveIncidentRefs(supabase, facilityId, input)
  if (!refs.ok) return { error: refs.error }

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

  const occurredAtIso = new Date(input.occurred_at).toISOString()
  const activityOther = refs.resolvedActivityId
    ? null
    : input.activity_other || null

  const { error: updErr } = await supabase
    .from("incident_reports")
    .update({
      severity_level_id: input.severity_level_id,
      activity_id: refs.resolvedActivityId,
      activity_other: activityOther,
      location_other: input.location_other || null,
      immediate_actions: input.immediate_actions || null,
      occurred_at: occurredAtIso,
      reporter_name: input.reporter_name,
      reporter_phone: input.reporter_phone,
      description: input.description,
      ambulance_flag: input.ambulance_flag,
      persons_involved: input.persons_involved,
      follow_up_required: input.follow_up_required,
    })
    .eq("id", reportId)
  if (updErr) return { error: dbError(updErr, "Failed to update report.") }

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
  if (input.witnesses.length > 0) {
    const { error: insWitErr } = await supabase.from("incident_witnesses").insert(
      input.witnesses.map((w, i) => ({
        incident_id: reportId,
        facility_id: facilityId,
        name: w.name,
        phone: w.phone,
        email: w.email,
        statement: w.statement,
        sort_order: i,
      })),
    )
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
      ambulance_flag: existing.ambulance_flag,
      persons_involved: existing.persons_involved,
      follow_up_required: existing.follow_up_required,
      space_ids: (existingSpaceRows ?? []).map((s) => s.space_id),
      witnesses: existingWitnessRows ?? [],
    },
    after: {
      severity_level_id: input.severity_level_id,
      activity_id: refs.resolvedActivityId,
      activity_other: activityOther,
      location_other: input.location_other || null,
      immediate_actions: input.immediate_actions || null,
      occurred_at: occurredAtIso,
      reporter_name: input.reporter_name,
      reporter_phone: input.reporter_phone,
      description: input.description,
      ambulance_flag: input.ambulance_flag,
      persons_involved: input.persons_involved,
      follow_up_required: input.follow_up_required,
      space_ids: refs.validSpaceIds,
      witnesses: input.witnesses,
    },
  })

  revalidatePath(`/reports/incidents/${reportId}`)
  redirect(`/reports/incidents/${reportId}?saved=1`)
}
