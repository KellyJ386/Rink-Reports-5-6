// Shared incident-submission pipeline used by BOTH the online server action
// (`actions.ts`) and the offline replay endpoint (`/api/offline-sync`). Keeping
// parse → validate → resolve → persist in one place means an offline submission
// lands the same rows, with the same checks, as an online one.
//
// Server-only module (it imports the server Supabase client type and the
// notification dispatcher). The client form never imports this — it just builds
// the JSON payload that `buildInputFromPayload` parses here.

import { dispatchRulesForSubmission } from "@/lib/notifications/dispatch"
import type { createClient } from "@/lib/supabase/server"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

export const DESCRIPTION_MAX = 500
export const MAX_WITNESSES = 3

export type IncidentFieldName =
  | "occurred_at"
  | "severity_level_id"
  | "description"

export type WitnessInput = {
  name: string
  phone: string | null
  email: string | null
  statement: string | null
}

export type IncidentInput = {
  description: string
  occurred_at: string // raw datetime-local string
  severity_level_id: string
  activity_id: string
  activity_other: string
  location_other: string
  immediate_actions: string
  space_ids: string[]
  witnesses: WitnessInput[]
  witnessMissingContact: boolean
}

export type IncidentValidation = {
  fieldErrors: Partial<Record<IncidentFieldName, string>>
  error?: string
}

/** Result shape returned by the submit/update server actions to the form. */
export type SubmissionFormState = {
  error?: string
  fieldErrors?: Partial<Record<IncidentFieldName, string>>
}

export type ResolvedRefs =
  | { ok: true; resolvedActivityId: string | null; validSpaceIds: string[] }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

function normalizeWitnesses(raw: unknown): {
  rows: WitnessInput[]
  missingContact: boolean
} {
  if (!Array.isArray(raw)) return { rows: [], missingContact: false }
  const rows: WitnessInput[] = []
  let missingContact = false
  for (const item of raw) {
    if (rows.length >= MAX_WITNESSES) break
    if (!item || typeof item !== "object") continue
    const obj = item as Record<string, unknown>
    const name = str(obj.name)
    if (!name) continue
    const phone = str(obj.phone)
    const email = str(obj.email)
    const statement = str(obj.statement)
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

function normalizeSpaceIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out = new Set<string>()
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) out.add(item.trim())
  }
  return Array.from(out)
}

/** Build a normalized input from the online form's FormData. */
export function buildInputFromForm(formData: FormData): IncidentInput {
  const get = (k: string) => String(formData.get(k) ?? "").trim()
  let witnessesRaw: unknown = []
  try {
    witnessesRaw = JSON.parse(String(formData.get("witnesses_json") ?? "[]"))
  } catch {
    witnessesRaw = []
  }
  let spacesRaw: unknown = []
  try {
    spacesRaw = JSON.parse(String(formData.get("spaces_json") ?? "[]"))
  } catch {
    spacesRaw = []
  }
  const { rows, missingContact } = normalizeWitnesses(witnessesRaw)
  return {
    description: get("description"),
    occurred_at: get("occurred_at"),
    severity_level_id: get("severity_level_id"),
    activity_id: get("activity_id"),
    activity_other: get("activity_other"),
    location_other: get("location_other"),
    immediate_actions: get("immediate_actions"),
    space_ids: normalizeSpaceIds(spacesRaw),
    witnesses: rows,
    witnessMissingContact: missingContact,
  }
}

/** Build a normalized input from a queued offline payload (untrusted JSON). */
export function buildInputFromPayload(raw: unknown): IncidentInput | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const { rows, missingContact } = normalizeWitnesses(obj.witnesses)
  return {
    description: str(obj.description),
    occurred_at: str(obj.occurred_at),
    severity_level_id: str(obj.severity_level_id),
    activity_id: str(obj.activity_id),
    activity_other: str(obj.activity_other),
    location_other: str(obj.location_other),
    immediate_actions: str(obj.immediate_actions),
    space_ids: normalizeSpaceIds(obj.space_ids),
    witnesses: rows,
    witnessMissingContact: missingContact,
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateIncidentInput(input: IncidentInput): IncidentValidation {
  const fieldErrors: Partial<Record<IncidentFieldName, string>> = {}
  if (!input.occurred_at) {
    fieldErrors.occurred_at = "Please choose when the incident happened."
  } else if (Number.isNaN(new Date(input.occurred_at).getTime())) {
    fieldErrors.occurred_at = "Invalid date and time."
  }
  if (!input.severity_level_id)
    fieldErrors.severity_level_id = "Please pick a severity level."
  if (!input.description) {
    fieldErrors.description = "Please describe what happened."
  } else if (input.description.length > DESCRIPTION_MAX) {
    fieldErrors.description = `Description must be ${DESCRIPTION_MAX} characters or fewer.`
  }

  let error: string | undefined
  if (input.witnessMissingContact) {
    error =
      "Each witness needs a name and at least one contact (phone or email)."
  } else if (input.space_ids.length === 0 && !input.location_other) {
    error = "Please choose at least one facility space (or add an “Other”)."
  }

  return { fieldErrors, error }
}

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
    reporterName: string
    input: IncidentInput
    refs: { resolvedActivityId: string | null; validSpaceIds: string[] }
  },
): Promise<PersistResult> {
  const { employeeId, facilityId, reporterName, input, refs } = args
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
      reporter_name: reporterName,
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
      reporter_name: reporterName,
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
    subject: `Incident report submitted by ${reporterName}`,
    body: input.description,
  })

  return { ok: true, reportId }
}
