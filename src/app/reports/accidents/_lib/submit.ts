// Server-only accident-submission pipeline used by BOTH the online server
// action (`actions.ts`) and the offline replay endpoint (`/api/offline-sync`).
// Pure parsing/validation lives in `compute.ts` (unit-tested); this module adds
// the Supabase + notification I/O so an offline submission lands the same rows,
// with the same checks, as an online one.

import { getFacilityTimezone } from "@/lib/facility-timezone"
import { dispatchRulesForSubmission } from "@/lib/notifications/dispatch"
import type { createClient } from "@/lib/supabase/server"
import { wallTimeToUtc } from "@/lib/timezone"
import type { Database } from "@/types/database"

import type { AccidentReportSnapshot } from "../types"
import { severityKeyToAlertSeverity, type AccidentInput } from "./compute"

// Re-export the parsers/validators the callers import from here.
export {
  buildInputFromForm,
  buildInputFromPayload,
  validateFields,
} from "./compute"
export type { AccidentInput, AccidentFieldName } from "./compute"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>
type AccidentReportInsert =
  Database["public"]["Tables"]["accident_reports"]["Insert"]

type SupabaseError = { code?: string; message?: string } | null
function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

export type PersistResult =
  | { ok: true; reportId: string }
  | { ok: false; error: string }

/**
 * Full persist: insert the report shell, body parts, witnesses, change-log
 * snapshot, optional medical-attention alert, and notification fan-out. Mirrors
 * the online action's cleanup-on-failure (a failed dependent insert deletes the
 * report shell so a partial submission never lands).
 *
 * The caller is responsible for the permission gate (`currentUserCan`) before
 * invoking this; the field-level validation guard belongs to the form/replay
 * layer (see `validateFields`), and there is no critical-note style guard here.
 */
export async function persistAccident(
  supabase: SupabaseClient,
  args: {
    employeeId: string
    facilityId: string
    input: AccidentInput
  },
): Promise<PersistResult> {
  const { employeeId, facilityId, input } = args

  // occurred_at arrives as the reporter's wall clock (datetime-local string);
  // interpret it in the FACILITY's timezone so the stored value is a real UTC
  // instant (migration 174). Null timezone falls back to the runtime zone.
  const tz = await getFacilityTimezone(supabase, facilityId)
  const occurredAt = wallTimeToUtc(input.occurred_at, tz)
  if (!occurredAt) return { ok: false, error: "Invalid date and time." }
  const occurredIso = occurredAt.toISOString()
  const workersCompAckAt =
    input.workers_comp && input.workers_comp_ack
      ? new Date().toISOString()
      : null

  const insertPayload: AccidentReportInsert = {
    facility_id: facilityId,
    employee_id: employeeId,
    injured_person_name: input.injured_person_name,
    injured_person_contact: input.injured_person_contact,
    injured_person_age: input.injured_person_age,
    description: input.description,
    occurred_at: occurredIso,
    location_dropdown_id: input.location_dropdown_id,
    activity_dropdown_id: input.activity_dropdown_id,
    severity_dropdown_id: input.severity_dropdown_id,
    medical_attention_dropdown_id: input.medical_attention_dropdown_id,
    primary_injury_type_dropdown_id: input.primary_injury_type_dropdown_id,
    workers_comp: input.workers_comp,
    workers_comp_acknowledged_at: workersCompAckAt,
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("accident_reports")
    .insert(insertPayload)
    .select(
      "id, facility_id, employee_id, injured_person_name, injured_person_contact, description, occurred_at, submitted_at, edit_window_ends_at, workers_comp, workers_comp_acknowledged_at, location_dropdown_id, activity_dropdown_id, severity_dropdown_id, medical_attention_dropdown_id, primary_injury_type_dropdown_id"
    )
    .single()

  if (insertErr || !inserted) {
    return {
      ok: false,
      error: dbError(insertErr, "Failed to submit accident report."),
    }
  }

  const reportId = inserted.id

  // Best-effort cleanup wrapper.
  const cleanupAndFail = async (msg: string): Promise<PersistResult> => {
    await supabase.from("accident_reports").delete().eq("id", reportId)
    return { ok: false, error: msg }
  }

  // Insert body part rows in batch.
  if (input.body_parts.length > 0) {
    const rows = input.body_parts.map((bp) => ({
      accident_id: reportId,
      facility_id: facilityId,
      body_part_dropdown_id: bp.body_part_dropdown_id,
      side: bp.side,
      laterality: bp.laterality,
    }))
    const { error: bpErr } = await supabase
      .from("accident_body_part_selections")
      .insert(rows)
    if (bpErr) {
      return cleanupAndFail(
        dbError(bpErr, "Failed to save body part selections.")
      )
    }
  }

  // Insert witnesses in batch.
  if (input.witnesses.length > 0) {
    const witnessRows = input.witnesses.map((w, i) => ({
      accident_id: reportId,
      facility_id: facilityId,
      name: w.name,
      contact: w.contact,
      statement: w.statement,
      sort_order: i,
    }))
    const { error: wErr } = await supabase
      .from("accident_witnesses")
      .insert(witnessRows)
    if (wErr) {
      return cleanupAndFail(dbError(wErr, "Failed to save witnesses."))
    }
  }

  // Build snapshot for change log.
  const snapshot: AccidentReportSnapshot = {
    id: inserted.id,
    facility_id: inserted.facility_id,
    employee_id: inserted.employee_id,
    injured_person_name: inserted.injured_person_name,
    injured_person_contact: inserted.injured_person_contact,
    injured_person_age: input.injured_person_age,
    description: inserted.description,
    occurred_at: inserted.occurred_at,
    submitted_at: inserted.submitted_at,
    edit_window_ends_at: inserted.edit_window_ends_at,
    workers_comp: inserted.workers_comp,
    workers_comp_acknowledged_at: inserted.workers_comp_acknowledged_at,
    location_dropdown_id: inserted.location_dropdown_id,
    activity_dropdown_id: inserted.activity_dropdown_id,
    severity_dropdown_id: inserted.severity_dropdown_id,
    medical_attention_dropdown_id: inserted.medical_attention_dropdown_id,
    primary_injury_type_dropdown_id: inserted.primary_injury_type_dropdown_id,
    body_parts: input.body_parts,
    witnesses: input.witnesses,
  }

  const { error: logErr } = await supabase.from("accident_change_log").insert({
    accident_id: reportId,
    facility_id: facilityId,
    employee_id: employeeId,
    action: "create",
    before: null,
    after: snapshot,
  })
  if (logErr) {
    return cleanupAndFail(dbError(logErr, "Failed to record change log."))
  }

  // Medical-attention alert.
  if (input.medical_attention_dropdown_id) {
    const { data: medRow } = await supabase
      .from("accident_dropdowns")
      .select("display_name, metadata, key")
      .eq("id", input.medical_attention_dropdown_id)
      .maybeSingle()

    const triggers =
      medRow?.metadata &&
      typeof medRow.metadata === "object" &&
      !Array.isArray(medRow.metadata) &&
      (medRow.metadata as Record<string, unknown>).triggers_alert === true

    if (triggers) {
      let severityKey: string | null = null
      if (input.severity_dropdown_id) {
        const { data: sevRow } = await supabase
          .from("accident_dropdowns")
          .select("key")
          .eq("id", input.severity_dropdown_id)
          .maybeSingle()
        severityKey = sevRow?.key ?? null
      }

      const summary = `${input.injured_person_name} — ${
        medRow?.display_name ?? "medical attention"
      }. ${input.description.slice(0, 200)}${
        input.description.length > 200 ? "…" : ""
      }`

      await supabase.from("communication_alerts").insert({
        facility_id: facilityId,
        source_module: "accident_reports",
        source_record_id: reportId,
        severity: severityKeyToAlertSeverity(severityKey),
        title: "Accident report requires medical attention follow-up",
        body: summary,
        created_by_employee_id: employeeId,
        requires_acknowledgement: true,
      })
      // If alert insert fails, we leave the report intact — the alert is a
      // best-effort side-effect, not a precondition.
    }
  }

  await dispatchRulesForSubmission({
    facilityId,
    sourceModule: "accident_reports",
    sourceRecordId: reportId,
    subject: "Accident report submitted",
  })

  return { ok: true, reportId }
}
