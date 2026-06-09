// Server-only refrigeration-submission pipeline used by BOTH the online server
// action (`actions.ts`) and the offline replay endpoint (`/api/offline-sync`).
// Pure parsing/compute/validation lives in `compute.ts` (unit-tested); this
// module adds the Supabase + notification I/O so an offline submission lands the
// same rows, with the same checks, as an online one.

import { dispatchRulesForSubmission } from "@/lib/notifications/dispatch"
import type { createClient } from "@/lib/supabase/server"
import type { TablesInsert } from "@/types/database"

import type { ThresholdSeverity } from "../types"
import {
  buildComputedRows,
  followupKey,
  isEmptyRow,
  SEVERITY_RANK,
  validateCriticalFollowups,
  VALID_SEVERITIES,
  type FieldConfigRow,
  type OorDetail,
  type RefrigerationInput,
  type RowToInsert,
  type ThresholdRow,
} from "./compute"

// Re-export the parsers the callers import from here.
export {
  buildInputFromForm,
  buildInputFromPayload,
} from "./compute"
export type { RefrigerationInput } from "./compute"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

type SupabaseError = { code?: string; message?: string } | null
function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

export type PrepareResult =
  | { ok: true; rows: RowToInsert[]; oorDetails: OorDetail[] }
  | { ok: false; error: string }

/**
 * Load thresholds + field config, derive computed rows, compute out-of-range
 * flags, and enforce the critical-note guard. Returns the rows ready to insert
 * (with an in-memory `_severity` marker) or a validation error.
 */
export async function prepareRows(
  supabase: SupabaseClient,
  args: {
    facilityId: string
    reportId: string
    input: RefrigerationInput
  },
): Promise<PrepareResult> {
  const { facilityId, reportId, input } = args

  const nonEmpty = input.values.filter((row) => !isEmptyRow(row))

  const [{ data: thresholdsRaw, error: thresholdErr }, { data: fieldsRaw }] =
    await Promise.all([
      supabase
        .from("refrigeration_thresholds")
        .select("id, field_id, equipment_id, min_value, max_value, severity")
        .eq("facility_id", facilityId)
        .eq("is_active", true),
      supabase
        .from("refrigeration_fields")
        .select(
          "id, section_id, equipment_id, key, label, unit, field_type, options",
        )
        .eq("facility_id", facilityId)
        .eq("is_active", true),
    ])

  if (thresholdErr) {
    return { ok: false, error: dbError(thresholdErr, "Failed to load thresholds.") }
  }

  const thresholds = (thresholdsRaw ?? []) as ThresholdRow[]
  const allFields = (fieldsRaw ?? []) as FieldConfigRow[]
  const fieldById = new Map(allFields.map((f) => [f.id, f]))
  const computedFields = allFields.filter((f) => f.field_type === "computed")

  function lookupThreshold(
    fieldId: string,
    equipmentId: string | null,
  ): ThresholdRow | null {
    if (equipmentId) {
      const eqMatch = thresholds.find(
        (t) => t.field_id === fieldId && t.equipment_id === equipmentId,
      )
      if (eqMatch) return eqMatch
    }
    return (
      thresholds.find((t) => t.field_id === fieldId && t.equipment_id === null) ??
      null
    )
  }

  const rows: RowToInsert[] = []
  const oorDetails: OorDetail[] = []

  const computeOor = (
    fieldId: string | null,
    equipmentId: string | null,
    value: number,
    label: string,
    equipmentName: string | null,
    unit: string | null,
  ): {
    thresholdId: string | null
    isOor: boolean
    severity: ThresholdSeverity | null
  } => {
    if (!fieldId) return { thresholdId: null, isOor: false, severity: null }
    const t = lookupThreshold(fieldId, equipmentId)
    if (!t) return { thresholdId: null, isOor: false, severity: null }
    const minOut = t.min_value !== null && value < t.min_value
    const maxOut = t.max_value !== null && value > t.max_value
    const sev: ThresholdSeverity = VALID_SEVERITIES.has(
      t.severity as ThresholdSeverity,
    )
      ? (t.severity as ThresholdSeverity)
      : "warn"
    if (minOut || maxOut) {
      oorDetails.push({
        label,
        equipment: equipmentName ?? "",
        value,
        unit,
        min: t.min_value,
        max: t.max_value,
        severity: sev,
      })
      return { thresholdId: t.id, isOor: true, severity: sev }
    }
    return { thresholdId: t.id, isOor: false, severity: sev }
  }

  // 1) Submitted (client) values.
  for (const row of nonEmpty) {
    let thresholdId: string | null = null
    let isOor = false
    let severity: ThresholdSeverity | null = null
    if (
      row.field_type_snapshot === "numeric" &&
      typeof row.value_numeric === "number"
    ) {
      const res = computeOor(
        row.field_id,
        row.equipment_id,
        row.value_numeric,
        row.label_snapshot,
        row.equipment_name_snapshot,
        row.unit_snapshot,
      )
      thresholdId = res.thresholdId
      isOor = res.isOor
      severity = res.severity
    }
    rows.push({
      facility_id: facilityId,
      report_id: reportId,
      field_id: row.field_id,
      equipment_id: row.equipment_id,
      label_snapshot: row.label_snapshot,
      equipment_name_snapshot: row.equipment_name_snapshot,
      field_type_snapshot: row.field_type_snapshot,
      unit_snapshot: row.unit_snapshot,
      value_text: row.value_text,
      value_numeric: row.value_numeric,
      value_boolean: row.value_boolean,
      threshold_id: thresholdId,
      is_out_of_range: isOor,
      _severity: severity,
    })
  }

  // 2) Derived computed values (read-only; evaluated here, never from client).
  const numericValues = nonEmpty
    .filter((r) => typeof r.value_numeric === "number")
    .map((r) => ({ field_id: r.field_id, value_numeric: r.value_numeric as number }))
  for (const c of buildComputedRows(computedFields, numericValues, fieldById)) {
    const res = computeOor(
      c.field.id,
      c.field.equipment_id,
      c.value,
      c.field.label,
      null,
      c.field.unit,
    )
    rows.push({
      facility_id: facilityId,
      report_id: reportId,
      field_id: c.field.id,
      equipment_id: c.field.equipment_id,
      label_snapshot: c.field.label,
      equipment_name_snapshot: null,
      field_type_snapshot: "computed",
      unit_snapshot: c.field.unit,
      value_text: null,
      value_numeric: c.value,
      value_boolean: null,
      threshold_id: res.thresholdId,
      is_out_of_range: res.isOor,
      _severity: res.severity,
    })
  }

  // 3) Critical-out-of-range readings require a corrective-action note.
  const guardError = validateCriticalFollowups(rows, input.followups)
  if (guardError) return { ok: false, error: guardError }

  return { ok: true, rows, oorDetails }
}

export type PersistResult =
  | { ok: true; reportId: string }
  | { ok: false; error: string }

/**
 * Full persist: insert the report shell, prepare + insert values, link follow-up
 * notes to their report_value_id, fire the optional bundled OOR alert, and
 * dispatch notifications. Mirrors the incident pipeline's cleanup-on-failure.
 */
export async function persistRefrigeration(
  supabase: SupabaseClient,
  args: {
    employeeId: string
    facilityId: string
    input: RefrigerationInput
  },
): Promise<PersistResult> {
  const { employeeId, facilityId, input } = args
  const trimmedNotes = (input.notes ?? "").trim()

  // 1) Report shell.
  const insertReport: TablesInsert<"refrigeration_reports"> = {
    facility_id: facilityId,
    employee_id: employeeId,
    notes: trimmedNotes.length > 0 ? trimmedNotes : null,
    submitted_at: new Date().toISOString(),
    reading_at: input.reading_at ?? new Date().toISOString(),
    shift: input.shift,
    round_no: input.round_no,
  }
  const { data: insertedReport, error: reportErr } = await supabase
    .from("refrigeration_reports")
    .insert(insertReport)
    .select("id")
    .single()

  if (reportErr || !insertedReport) {
    return {
      ok: false,
      error: dbError(reportErr, "Failed to submit refrigeration report."),
    }
  }
  const reportId = insertedReport.id

  const cleanupAndFail = async (msg: string): Promise<PersistResult> => {
    await supabase.from("refrigeration_reports").delete().eq("id", reportId)
    return { ok: false, error: msg }
  }

  // 2) Prepare rows (compute + guard). Guard failure rolls back the shell.
  const prepared = await prepareRows(supabase, { facilityId, reportId, input })
  if (!prepared.ok) return cleanupAndFail(prepared.error)

  const insertRows = prepared.rows.map(({ _severity, ...rest }) => {
    void _severity
    return rest
  })

  // 3) Insert values, capturing ids so notes can link to the exact reading.
  const insertedValueByKey = new Map<string, string>()
  if (insertRows.length > 0) {
    const { data: insertedValues, error: valuesErr } = await supabase
      .from("refrigeration_report_values")
      .insert(insertRows)
      .select("id, field_id, equipment_id")
    if (valuesErr || !insertedValues) {
      return cleanupAndFail(dbError(valuesErr, "Failed to save report values."))
    }
    for (const v of insertedValues) {
      if (v.field_id) {
        insertedValueByKey.set(followupKey(v.field_id, v.equipment_id), v.id)
      }
    }
  }

  // 4) Follow-up notes, linked to the report value they address.
  if (input.followups.length > 0) {
    const noteRows = input.followups.map((f) => ({
      facility_id: facilityId,
      report_id: reportId,
      employee_id: employeeId,
      body: f.body,
      is_admin_note: false,
      report_value_id:
        insertedValueByKey.get(followupKey(f.field_id, f.equipment_id)) ?? null,
      field_id: f.field_id,
    }))
    const { error: notesErr } = await supabase
      .from("refrigeration_followup_notes")
      .insert(noteRows)
    if (notesErr) {
      return cleanupAndFail(
        dbError(notesErr, "Failed to save corrective-action notes."),
      )
    }
  }

  // 5) Optional bundled out-of-range alert (best-effort; never rolls back).
  if (prepared.oorDetails.length > 0) {
    const { data: settingsRow } = await supabase
      .from("refrigeration_settings")
      .select("out_of_range_alerts_enabled")
      .eq("facility_id", facilityId)
      .maybeSingle()

    if (settingsRow?.out_of_range_alerts_enabled) {
      let topRank = 0
      let topSeverity: ThresholdSeverity = "warn"
      for (const d of prepared.oorDetails) {
        const rank = SEVERITY_RANK[d.severity]
        if (rank > topRank) {
          topRank = rank
          topSeverity = d.severity
        }
      }
      const lines = prepared.oorDetails.slice(0, 5).map((d) => {
        const unit = d.unit ? ` ${d.unit}` : ""
        const bound =
          d.min !== null && d.value < d.min
            ? `(min ${d.min}${unit})`
            : d.max !== null && d.value > d.max
              ? `(max ${d.max}${unit})`
              : ""
        return `${d.equipment} ${d.label}: ${d.value}${unit} ${bound}`.trim()
      })
      const remainder = prepared.oorDetails.length - lines.length
      const bodyParts = [...lines]
      if (remainder > 0) bodyParts.push(`…and ${remainder} more`)

      await supabase.from("communication_alerts").insert({
        facility_id: facilityId,
        source_module: "refrigeration",
        source_record_id: reportId,
        severity: topSeverity,
        title: `Refrigeration: ${prepared.oorDetails.length} out-of-range reading${
          prepared.oorDetails.length === 1 ? "" : "s"
        }`,
        body: bodyParts.join("\n"),
        created_by_employee_id: employeeId,
        requires_acknowledgement: true,
      })
    }
  }

  // 6) Notification fan-out (best-effort).
  await dispatchRulesForSubmission({
    facilityId,
    sourceModule: "refrigeration",
    sourceRecordId: reportId,
    subject: "Refrigeration report submitted",
  })

  return { ok: true, reportId }
}
