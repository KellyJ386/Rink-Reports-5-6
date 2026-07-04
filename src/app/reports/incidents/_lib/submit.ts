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

// ---------------------------------------------------------------------------
// Reporter identity (from login, never from client input)
// ---------------------------------------------------------------------------

/**
 * Resolve the reporter's name + phone from the authenticated user's profile
 * row. The incident form no longer collects these — they're sourced from the
 * login so a reporter can't spoof someone else's identity. Callers inject the
 * result into `IncidentInput` before persisting.
 */
export async function resolveReporterIdentity(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ reporter_name: string; reporter_phone: string }> {
  const { data } = await supabase
    .from("users")
    .select("full_name, phone")
    .eq("id", userId)
    .maybeSingle()
  return {
    reporter_name: (data?.full_name ?? "").trim(),
    reporter_phone: (data?.phone ?? "").trim(),
  }
}

export type ResolvedRefs =
  | {
      ok: true
      resolvedActivityId: string | null
      resolvedIncidentTypeId: string | null
      validSpaceIds: string[]
    }
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

  let resolvedIncidentTypeId: string | null = null
  if (input.incident_type_id) {
    const { data: incidentType } = await supabase
      .from("incident_types")
      .select("id, is_active")
      .eq("id", input.incident_type_id)
      .eq("facility_id", facilityId)
      .maybeSingle()
    if (!incidentType || !incidentType.is_active) {
      return { ok: false, error: "Selected incident type is not available." }
    }
    resolvedIncidentTypeId = incidentType.id
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

  return {
    ok: true,
    resolvedActivityId,
    resolvedIncidentTypeId,
    validSpaceIds,
  }
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
    refs: {
      resolvedActivityId: string | null
      resolvedIncidentTypeId: string | null
      validSpaceIds: string[]
    }
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
      incident_type_id: refs.resolvedIncidentTypeId || null,
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
    // Best-effort: incident_reports DELETE is RLS-restricted to super admins,
    // so under a staff session this delete is a no-op and a partial report row
    // remains. Log it so the orphan is traceable rather than silent.
    const { error: delErr } = await supabase
      .from("incident_reports")
      .delete()
      .eq("id", reportId)
    if (delErr) {
      console.error(
        `[incidents] could not clean up partial report ${reportId} after "${msg}":`,
        delErr.message,
      )
    }
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
      incident_type_id: refs.resolvedIncidentTypeId || null,
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
      ambulance_flag: input.ambulance_flag,
      persons_involved: input.persons_involved,
      follow_up_required: input.follow_up_required,
      space_ids: refs.validSpaceIds,
      witnesses: input.witnesses,
    },
  })
  if (logErr) {
    return cleanupAndFail(dbError(logErr, "Failed to record change log."))
  }

  // Ambulance escalation — mirrors the accident "medical_attention" alert. When
  // an ambulance was called we raise a critical, acknowledgement-requiring
  // communication_alert so it surfaces above the routine fan-out. Best-effort:
  // a failed alert never blocks the report itself.
  if (input.ambulance_flag) {
    const summary = `Ambulance called — reported by ${
      input.reporter_name
    }. ${input.description.slice(0, 200)}${
      input.description.length > 200 ? "…" : ""
    }`
    const { error: alertErr } = await supabase
      .from("communication_alerts")
      .insert({
        facility_id: facilityId,
        source_module: "incident_reports",
        source_record_id: reportId,
        severity: "critical",
        title: "Incident report — ambulance called",
        body: summary,
        created_by_employee_id: employeeId,
        requires_acknowledgement: true,
      })
    if (alertErr) {
      console.error(
        `[incidents] ambulance alert insert failed for report ${reportId}:`,
        alertErr.message,
      )
    }
  }

  // Best-effort notification fan-out — never blocks the submission. When an
  // ambulance was called we tag the dispatch as "critical" so facilities can
  // route a higher-priority recipient set via communication_routing_rules
  // (severity-scoped rules) without any new recipient UI.
  await dispatchRulesForSubmission({
    facilityId,
    sourceModule: "incident_reports",
    sourceRecordId: reportId,
    severity: input.ambulance_flag ? "critical" : undefined,
    subject: input.ambulance_flag
      ? `Ambulance called — incident reported by ${input.reporter_name}`
      : `Incident report submitted by ${input.reporter_name}`,
    body: input.description,
  })

  return { ok: true, reportId }
}
