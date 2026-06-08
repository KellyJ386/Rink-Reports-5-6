// Server-only ice-operations submission pipeline used by BOTH the online server
// action (`../actions.ts`) and the offline replay endpoint (`/api/offline-sync`).
// Pure parsing/validation lives in `compute.ts` (unit-tested); this module adds
// the Supabase + notification I/O so an offline submission lands the same rows,
// with the same checks, as an online one.
//
// All FOUR operation types (ice_make, blade_change, edging, circle_check) route
// through `persistIceOperation`; the circle-check path additionally writes the
// per-item results, the failed-count rollup, and a best-effort alert.

import "server-only"

import { dispatchRulesForSubmission } from "@/lib/notifications/dispatch"
import type { createClient } from "@/lib/supabase/server"
import type { Json } from "@/types/database"

import type { IceOpsInput } from "./compute"

// Re-export the parsers/validators the callers import from here.
export {
  buildInputFromForm,
  buildInputFromObject,
  buildInputFromPayload,
  validateIceOpsInput,
} from "./compute"
export type { IceOpsInput } from "./compute"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

const VALID_SEVERITIES = new Set(["warn", "high", "critical"])

export type PersistResult =
  | { ok: true; reportId: string }
  | { ok: false; error: string }

/** Build the jsonb `payload` column for the submission shell. */
function buildPayload(input: IceOpsInput): Json {
  switch (input.fields.type) {
    case "ice_make":
      return {
        water_used_gal: input.fields.water_used_gal,
        machine_hours: input.fields.machine_hours,
        snow_taken_pct: input.fields.snow_taken_pct,
        time_in: input.fields.time_in,
        time_out: input.fields.time_out,
      }
    case "edging":
      return { hours_run: input.fields.hours_run }
    case "blade_change":
      return {
        blade_serial: input.fields.blade_serial,
        hours_at_change: input.fields.hours_at_change,
        replaced_by_employee_id: input.fields.replaced_by_employee_id,
      }
    case "circle_check":
      return {}
  }
}

/**
 * Persist a validated ice-operations submission. The caller is responsible for
 * authentication, resolving the active employee, the `submit` permission check,
 * and the pure `validateIceOpsInput` guard; this function does the
 * facility-scoped reference validation (rink/equipment), the inserts, the
 * circle-check results + rollup + alert, and the notification fan-out. On any
 * insert failure after the submission shell lands, the shell is deleted so the
 * submission can be retried cleanly.
 */
export async function persistIceOperation(
  supabase: SupabaseClient,
  {
    employeeId,
    facilityId,
    input,
  }: { employeeId: string; facilityId: string; input: IceOpsInput },
): Promise<PersistResult> {
  const { operation_type: operationType, rink_id: rinkId, equipment_id: equipmentId } =
    input

  if (!equipmentId) {
    return { ok: false, error: "Please pick the equipment used." }
  }
  if (!input.occurred_at) {
    return { ok: false, error: "Please choose when the operation happened." }
  }

  // Verify rink + equipment belong to this facility (rink only if provided).
  if (rinkId) {
    const { data: rinkRow } = await supabase
      .from("ice_operations_rinks")
      .select("id, facility_id, is_active")
      .eq("id", rinkId)
      .eq("facility_id", facilityId)
      .maybeSingle()
    if (!rinkRow || !rinkRow.is_active) {
      return { ok: false, error: "Selected rink is not available." }
    }
  }

  const { data: equipmentRow } = await supabase
    .from("ice_operations_equipment")
    .select("id, facility_id, is_active, equipment_type")
    .eq("id", equipmentId)
    .eq("facility_id", facilityId)
    .maybeSingle()

  if (!equipmentRow || !equipmentRow.is_active) {
    return { ok: false, error: "Selected equipment is not available." }
  }

  // 1) Insert the submission shell.
  const { data: insertedSubmission, error: subErr } = await supabase
    .from("ice_operations_submissions")
    .insert({
      facility_id: facilityId,
      employee_id: employeeId,
      operation_type: operationType,
      rink_id: rinkId,
      equipment_id: equipmentId,
      occurred_at: input.occurred_at,
      submitted_at: new Date().toISOString(),
      notes: input.notes,
      payload: buildPayload(input),
      has_failed_check: false,
      failed_count: 0,
    })
    .select("id")
    .single()

  if (subErr || !insertedSubmission) {
    return {
      ok: false,
      error: dbError(subErr, "Failed to submit ice operations report."),
    }
  }

  const submissionId = insertedSubmission.id

  const cleanupAndFail = async (msg: string): Promise<PersistResult> => {
    await supabase
      .from("ice_operations_submissions")
      .delete()
      .eq("id", submissionId)
    return { ok: false, error: msg }
  }

  // 2) Circle-check results (+ rollup + alert). Other op types are done.
  if (input.fields.type === "circle_check") {
    const parsed = input.fields.results

    // Required: every failed item must have notes text. (Also enforced by the
    // pure validator before we get here; kept as defense-in-depth.)
    for (const r of parsed) {
      if (!r.passed && !r.failed_notes) {
        return cleanupAndFail(
          "Add a note explaining each failed checklist item.",
        )
      }
    }

    if (parsed.length > 0) {
      const rows = parsed.map((r) => ({
        facility_id: facilityId,
        submission_id: submissionId,
        checklist_item_id: r.checklist_item_id,
        label_snapshot: r.label_snapshot,
        passed: r.passed,
        failed_notes: r.failed_notes,
      }))
      const { error: resErr } = await supabase
        .from("ice_operations_circle_check_results")
        .insert(rows)
      if (resErr) {
        return cleanupAndFail(
          dbError(resErr, "Failed to save checklist results."),
        )
      }
    }

    const failedCount = parsed.filter((r) => !r.passed).length
    const hasFailed = failedCount > 0

    if (hasFailed || parsed.length > 0) {
      await supabase
        .from("ice_operations_submissions")
        .update({
          has_failed_check: hasFailed,
          failed_count: failedCount,
        })
        .eq("id", submissionId)
    }

    // 3) Best-effort alert on any failure.
    if (hasFailed) {
      const { data: settings } = await supabase
        .from("ice_operations_settings")
        .select("alerts_enabled, default_alert_severity")
        .eq("facility_id", facilityId)
        .maybeSingle()

      const alertsEnabled = settings?.alerts_enabled ?? true
      if (alertsEnabled) {
        const severityRaw =
          settings?.default_alert_severity?.toLowerCase() ?? "high"
        const severity = VALID_SEVERITIES.has(severityRaw)
          ? severityRaw
          : "high"

        let rinkName: string | null = null
        if (rinkId) {
          const { data: r } = await supabase
            .from("ice_operations_rinks")
            .select("name")
            .eq("id", rinkId)
            .maybeSingle()
          rinkName = r?.name ?? null
        }

        const failed = parsed.filter((p) => !p.passed)
        const lines = failed.slice(0, 8).map((f) => {
          const note = f.failed_notes ?? ""
          const truncated =
            note.length > 120 ? `${note.slice(0, 120).trimEnd()}…` : note
          return `• ${f.label_snapshot}: ${truncated}`
        })
        const remainder = failed.length - lines.length
        const bodyParts = [...lines]
        if (remainder > 0) bodyParts.push(`…and ${remainder} more`)

        const titleSuffix = rinkName ? ` (${rinkName})` : ""

        // Best-effort. Failure does not roll back the submission.
        await supabase.from("communication_alerts").insert({
          facility_id: facilityId,
          source_module: "ice_operations",
          source_record_id: submissionId,
          severity,
          title: `Ice Operations: Circle Check failed${titleSuffix}`,
          body: bodyParts.join("\n"),
          created_by_employee_id: employeeId,
          requires_acknowledgement: true,
        })
      }
    }
  }

  // 4) Notification fan-out (best-effort; never rolls back).
  await dispatchRulesForSubmission({
    facilityId,
    sourceModule: "ice_operations",
    sourceRecordId: submissionId,
    subject: "Ice operations report submitted",
  })

  return { ok: true, reportId: submissionId }
}
