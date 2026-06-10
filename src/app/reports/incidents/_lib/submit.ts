// Server-only incident-submission pipeline used by BOTH the online server
// action (`actions.ts`) and the offline replay endpoint (`/api/offline-sync`).
// Pure parsing/normalization/validation lives in `compute.ts` (unit-tested);
// this module adds the Supabase + notification I/O so an offline submission
// lands the same rows, with the same checks, as an online one.

import { dispatchRulesForSubmission } from "@/lib/notifications/dispatch"
import type { createClient } from "@/lib/supabase/server"

import type { IncidentInput } from "./compute"

// Re-export the pure helpers the callers import from here.
export {
  buildInputFromForm,
  buildInputFromPayload,
  validateIncidentInput,
  DESCRIPTION_MAX,
  MAX_WITNESSES,
} from "./compute"
export type {
  IncidentFieldName,
  IncidentInput,
  IncidentValidation,
  SubmissionFormState,
  WitnessInput,
} from "./compute"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

export type ResolvedRefs =
  | { ok: true; resolvedActivityId: string | null; validSpaceIds: string[] }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Facility-ref resolution (severity / activity / spaces belong to facility)
// ---------------------------------------------------------------------------

export async function resolveIncidentRefs(
  supabase: SupabaseClient,
  facilityId: string,
  input: IncidentInput,
): Promise<ResolvedRefs> {
  const { data: severity } = await supabase
    .from("incident_severity_levels")
    .select("id, is_active")
    .eq("id", input.severity_level_id)
    .eq("facility_id", facilityId)
    .maybeSingle()
  if (!severity || !severity.is_active) {
    return { ok: false, error: "Selected severity level is not available." }
  }

  let resolvedActivityId: string | null = null
  if (input.activity_id) {
    const { data: activity } = await supabase
      .from("incident_activities")
      .select("id, is_active")
      .eq("id", input.activity_id)
      .eq("facility_id", facilityId)
      .maybeSingle()
    if (!activity || !activity.is_active) {
      return { ok: false, error: "Selected activity is not available." }
    }
    resolvedActivityId = activity.id
  }

  let validSpaceIds: string[] = []
  if (input.space_ids.length > 0) {
    const { data: spaceRows } = await supabase
      .from("facility_spaces")
      .select("id")
      .in("id", input.space_ids)
      .eq("facility_id", facilityId)
      .eq("is_active", true)
    validSpaceIds = (spaceRows ?? []).map((s) => s.id)
  }
  if (validSpaceIds.length === 0 && !input.location_other) {
    return {
      ok: false,
      error: "Please choose at least one facility space (or add an “Other”).",
    }
  }

  return { ok: true, resolvedActivityId, validSpaceIds }
}

// ---------------------------------------------------------------------------
// Persist (insert report + children + change log + notification dispatch)
// ---------------------------------------------------------------------------

type SupabaseError = { code?: string; message?: string } | null
function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

export type PersistResult =
  | { ok: true; reportId: string }
  | { ok: false; error: string }

export async function persistIncident(
  supabase: SupabaseClient,
  args: {
    employeeId: string
    facilityId: string
    input: IncidentInput
    refs: { resolvedActivityId: string | null; validSpaceIds: string[] }
  },
): Promise<PersistResult> {
  const { employeeId, facilityId, input, refs } = args
  const occurredAtIso = new Date(input.occurred_at).toISOString()
  const activityOther = refs.resolvedActivityId
    ? null
    : input.activity_other || null

  const { data: inserted, error: insertErr } = await supabase
    .from("incident_reports")
    .insert({
      facility_id: facilityId,
      employee_id: employeeId,
      severity_level_id: input.severity_level_id,
      activity_id: refs.resolvedActivityId,
      activity_other: activityOther,
      location_other: input.location_other || null,
      immediate_actions: input.immediate_actions || null,
      occurred_at: occurredAtIso,
      reporter_name: input.reporter_name,
      reporter_phone: input.reporter_phone,
      description: input.description,
      status: "submitted",
      submitted_at: new Date().toISOString(),
    })
    .select("id, submitted_at, occurred_at, edit_window_ends_at")
    .single()

  if (insertErr || !inserted) {
    return { ok: false, error: dbError(insertErr, "Failed to save report.") }
  }

  const reportId = inserted.id
  const cleanupAndFail = async (msg: string): Promise<PersistResult> => {
    await supabase.from("incident_reports").delete().eq("id", reportId)
    return { ok: false, error: msg }
  }

  if (refs.validSpaceIds.length > 0) {
    const { error: spErr } = await supabase
      .from("incident_report_spaces")
      .insert(
        refs.validSpaceIds.map((space_id) => ({
          incident_id: reportId,
          facility_id: facilityId,
          space_id,
        })),
      )
    if (spErr) {
      return cleanupAndFail(dbError(spErr, "Failed to save facility spaces."))
    }
  }

  if (input.witnesses.length > 0) {
    const { error: wErr } = await supabase.from("incident_witnesses").insert(
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
    if (wErr) {
      return cleanupAndFail(dbError(wErr, "Failed to save witnesses."))
    }
  }

  const { error: logErr } = await supabase.from("incident_change_log").insert({
    incident_id: reportId,
    facility_id: facilityId,
    employee_id: employeeId,
    action: "create",
    before: null,
    after: {
      id: reportId,
      severity_level_id: input.severity_level_id,
      activity_id: refs.resolvedActivityId,
      activity_other: activityOther,
      location_other: input.location_other || null,
      immediate_actions: input.immediate_actions || null,
      occurred_at: inserted.occurred_at,
      submitted_at: inserted.submitted_at,
      edit_window_ends_at: inserted.edit_window_ends_at,
      reporter_name: input.reporter_name,
      reporter_phone: input.reporter_phone,
      description: input.description,
      space_ids: refs.validSpaceIds,
      witnesses: input.witnesses,
    },
  })
  if (logErr) {
    return cleanupAndFail(dbError(logErr, "Failed to record change log."))
  }

  // Best-effort notification fan-out — never blocks the submission.
  await dispatchRulesForSubmission({
    facilityId,
    sourceModule: "incident_reports",
    sourceRecordId: reportId,
    subject: `Incident report submitted by ${input.reporter_name}`,
    body: input.description,
  })

  return { ok: true, reportId }
}
