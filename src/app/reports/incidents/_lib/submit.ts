// Server-only incident-submission pipeline used by BOTH the online server
// action (`actions.ts`) and the offline replay endpoint (`/api/offline-sync`).
// Pure parsing/normalization/validation lives in `compute.ts` (unit-tested);
// this module adds the Supabase + notification I/O so an offline submission
// lands the same rows, with the same checks, as an online one.

import { getFacilityTimezone } from "@/lib/facility-timezone"
import { dispatchRulesForSubmission } from "@/lib/notifications/dispatch"
import type { createClient } from "@/lib/supabase/server"
import { wallTimeToUtc } from "@/lib/timezone"

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
// Persist (atomic RPC: report + children + change log in one transaction)
// ---------------------------------------------------------------------------

type SupabaseError = { code?: string; message?: string } | null
function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

export type PersistResult =
  | { ok: true; reportId: string }
  | { ok: false; error: string }

/** Witness rows serialized for the persist RPCs' jsonb parameter. */
export function witnessesJson(witnesses: IncidentInput["witnesses"]) {
  return witnesses.map((w) => ({
    name: w.name,
    phone: w.phone,
    email: w.email,
    statement: w.statement,
  }))
}

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
  // occurred_at arrives as the reporter's wall clock (datetime-local string);
  // interpret it in the FACILITY's timezone so the stored value is a real UTC
  // instant (migration 174). Null timezone falls back to the runtime zone.
  const tz = await getFacilityTimezone(supabase, facilityId)
  const occurredAt = wallTimeToUtc(input.occurred_at, tz)
  if (!occurredAt) return { ok: false, error: "Invalid date and time." }
  const occurredAtIso = occurredAt.toISOString()
  const activityOther = refs.resolvedActivityId
    ? null
    : input.activity_other || null

  // Single transaction (migration 173): report + spaces + witnesses + change
  // log land together or not at all — no more orphaned partial reports from a
  // mid-persist failure. SECURITY INVOKER, so the same RLS insert policies
  // apply as the previous row-by-row writes.
  const { data: reportId, error: rpcErr } = await supabase.rpc(
    "submit_incident_report",
    {
      p_facility_id: facilityId,
      p_employee_id: employeeId,
      p_severity_level_id: input.severity_level_id,
      p_incident_type_id: refs.resolvedIncidentTypeId || undefined,
      p_activity_id: refs.resolvedActivityId ?? undefined,
      p_activity_other: activityOther ?? undefined,
      p_location_other: input.location_other || undefined,
      p_immediate_actions: input.immediate_actions || undefined,
      p_occurred_at: occurredAtIso,
      p_reporter_name: input.reporter_name,
      p_reporter_phone: input.reporter_phone,
      p_description: input.description,
      p_ambulance_flag: input.ambulance_flag,
      p_persons_involved: input.persons_involved ?? undefined,
      p_follow_up_required: input.follow_up_required,
      p_space_ids: refs.validSpaceIds,
      p_witnesses: witnessesJson(input.witnesses),
    },
  )

  if (rpcErr || !reportId) {
    return { ok: false, error: dbError(rpcErr, "Failed to save report.") }
  }

  if (input.ambulance_flag) {
    await escalateAmbulance(supabase, {
      facilityId,
      employeeId,
      reportId,
      reporterName: input.reporter_name,
      description: input.description,
      phase: "submitted",
    })
  } else {
    // Best-effort notification fan-out — never blocks the submission.
    await dispatchRulesForSubmission({
      facilityId,
      sourceModule: "incident_reports",
      sourceRecordId: reportId,
      subject: `Incident report submitted by ${input.reporter_name}`,
      body: input.description,
    })
  }

  return { ok: true, reportId }
}

// ---------------------------------------------------------------------------
// Ambulance escalation (shared by create and by an edit that turns the flag on)
// ---------------------------------------------------------------------------

/**
 * Raise the ambulance escalation for a report: a critical,
 * acknowledgement-requiring communication_alert (mirrors the accident
 * "medical_attention" alert) plus a "critical"-severity routing-rule dispatch
 * so facilities can route a higher-priority recipient set. Best-effort by
 * design — a failed escalation never blocks the report itself, but is logged
 * so a missed escalation is traceable.
 */
export async function escalateAmbulance(
  supabase: SupabaseClient,
  args: {
    facilityId: string
    employeeId: string
    reportId: string
    reporterName: string
    description: string
    phase: "submitted" | "updated"
  },
): Promise<void> {
  const { facilityId, employeeId, reportId, reporterName, description, phase } =
    args
  const summary = `Ambulance called — reported by ${reporterName}. ${description.slice(0, 200)}${
    description.length > 200 ? "…" : ""
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

  await dispatchRulesForSubmission({
    facilityId,
    sourceModule: "incident_reports",
    sourceRecordId: reportId,
    severity: "critical",
    subject:
      phase === "updated"
        ? `Ambulance called — incident report updated by ${reporterName}`
        : `Ambulance called — incident reported by ${reporterName}`,
    body: description,
  })
}
