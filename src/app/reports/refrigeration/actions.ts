"use server"

import { redirect } from "next/navigation"

import { requireUser } from "@/lib/auth"
import { dispatchRulesForSubmission } from "@/lib/notifications/dispatch"
import { createClient } from "@/lib/supabase/server"

import type {
  RefrigerationFieldType,
  SubmittedFieldValue,
  SubmittedPayload,
  ThresholdSeverity,
} from "./types"

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

const VALID_FIELD_TYPES = new Set<RefrigerationFieldType>([
  "numeric",
  "text",
  "boolean",
  "select",
])

const VALID_SEVERITIES = new Set<ThresholdSeverity>([
  "warn",
  "high",
  "critical",
])

const SEVERITY_RANK: Record<ThresholdSeverity, number> = {
  warn: 1,
  high: 2,
  critical: 3,
}

type ParsedRow = SubmittedFieldValue & {
  // Marker — `value_text` may be a numeric input that failed to parse; in
  // that case we still emit the row but it never matches OOR.
}

function parsePayload(raw: string): SubmittedPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return null
    const obj = parsed as { notes?: unknown; values?: unknown }
    const notes = typeof obj.notes === "string" ? obj.notes : undefined
    const values: SubmittedFieldValue[] = []
    if (!Array.isArray(obj.values)) return { notes, values: [] }
    for (const item of obj.values) {
      if (!item || typeof item !== "object") continue
      const r = item as Record<string, unknown>
      const field_id = typeof r.field_id === "string" ? r.field_id : null
      if (!field_id) continue
      const equipment_id =
        typeof r.equipment_id === "string"
          ? r.equipment_id
          : r.equipment_id === null
            ? null
            : null
      const label_snapshot =
        typeof r.label_snapshot === "string" ? r.label_snapshot : ""
      const equipment_name_snapshot =
        typeof r.equipment_name_snapshot === "string"
          ? r.equipment_name_snapshot
          : ""
      const ftRaw =
        typeof r.field_type_snapshot === "string" ? r.field_type_snapshot : ""
      if (!VALID_FIELD_TYPES.has(ftRaw as RefrigerationFieldType)) continue
      const field_type_snapshot = ftRaw as RefrigerationFieldType
      const unit_snapshot =
        typeof r.unit_snapshot === "string" ? r.unit_snapshot : null
      const value_text =
        typeof r.value_text === "string" && r.value_text.length > 0
          ? r.value_text
          : null
      const value_numeric =
        typeof r.value_numeric === "number" && Number.isFinite(r.value_numeric)
          ? r.value_numeric
          : null
      const value_boolean =
        typeof r.value_boolean === "boolean" ? r.value_boolean : null

      values.push({
        field_id,
        equipment_id,
        label_snapshot,
        equipment_name_snapshot,
        field_type_snapshot,
        unit_snapshot,
        value_text,
        value_numeric,
        value_boolean,
      })
    }
    return { notes, values }
  } catch {
    return null
  }
}

function isEmptyRow(row: SubmittedFieldValue): boolean {
  return (
    row.value_text === null &&
    row.value_numeric === null &&
    row.value_boolean === null
  )
}

async function performSubmit(formData: FormData): Promise<SubmissionResult> {
  const current = await requireUser()
  const supabase = await createClient()

  const valuesJsonRaw = String(formData.get("values_json") ?? "")
  const payload = parsePayload(valuesJsonRaw)
  if (!payload) {
    return { ok: false, error: "Invalid form data." }
  }

  const { data: employeeRow, error: empErr } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  if (empErr) {
    return { ok: false, error: dbError(empErr, "Failed to load your account.") }
  }
  if (!employeeRow) {
    return {
      ok: false,
      error: "Your account isn't fully set up yet. Contact your administrator.",
    }
  }

  // Defense-in-depth permission check.
  const { data: perm } = await supabase
    .from("module_permissions")
    .select("can_submit")
    .eq("module_key", "refrigeration")
    .eq("employee_id", employeeRow.id)
    .maybeSingle()

  if (!perm?.can_submit) {
    return {
      ok: false,
      error: "You don't have permission to submit refrigeration reports.",
    }
  }

  const facilityId = employeeRow.facility_id
  const trimmedNotes = (payload.notes ?? "").trim()

  // 1) Insert the report shell.
  const { data: insertedReport, error: reportErr } = await supabase
    .from("refrigeration_reports")
    .insert({
      facility_id: facilityId,
      employee_id: employeeRow.id,
      notes: trimmedNotes.length > 0 ? trimmedNotes : null,
      submitted_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  if (reportErr || !insertedReport) {
    return {
      ok: false,
      error: dbError(reportErr, "Failed to submit refrigeration report."),
    }
  }

  const reportId = insertedReport.id

  // 2) Drop empty rows.
  const nonEmpty: ParsedRow[] = payload.values.filter(
    (row) => !isEmptyRow(row)
  )

  // 3) Pull all active thresholds for this facility for matching.
  const { data: thresholdsRaw, error: thresholdErr } = await supabase
    .from("refrigeration_thresholds")
    .select("id, field_id, equipment_id, min_value, max_value, severity")
    .eq("facility_id", facilityId)
    .eq("is_active", true)

  if (thresholdErr) {
    await supabase.from("refrigeration_reports").delete().eq("id", reportId)
    return {
      ok: false,
      error: dbError(thresholdErr, "Failed to load thresholds."),
    }
  }

  type ThresholdRow = {
    id: string
    field_id: string
    equipment_id: string | null
    min_value: number | null
    max_value: number | null
    severity: string
  }
  const thresholds = (thresholdsRaw ?? []) as ThresholdRow[]

  function lookupThreshold(
    fieldId: string,
    equipmentId: string | null
  ): ThresholdRow | null {
    if (equipmentId) {
      const eqMatch = thresholds.find(
        (t) => t.field_id === fieldId && t.equipment_id === equipmentId
      )
      if (eqMatch) return eqMatch
    }
    const sectionMatch = thresholds.find(
      (t) => t.field_id === fieldId && t.equipment_id === null
    )
    return sectionMatch ?? null
  }

  type RowToInsert = {
    facility_id: string
    report_id: string
    field_id: string
    equipment_id: string | null
    label_snapshot: string
    equipment_name_snapshot: string | null
    field_type_snapshot: string
    unit_snapshot: string | null
    value_text: string | null
    value_numeric: number | null
    value_boolean: boolean | null
    threshold_id: string | null
    is_out_of_range: boolean
  }

  type OorDetail = {
    label: string
    equipment: string
    value: number
    unit: string | null
    min: number | null
    max: number | null
    severity: ThresholdSeverity
  }

  const rowsToInsert: RowToInsert[] = []
  const oorDetails: OorDetail[] = []

  for (const row of nonEmpty) {
    let thresholdId: string | null = null
    let isOor = false

    if (
      row.field_type_snapshot === "numeric" &&
      typeof row.value_numeric === "number"
    ) {
      const t = lookupThreshold(row.field_id, row.equipment_id)
      if (t) {
        thresholdId = t.id
        const minOut = t.min_value !== null && row.value_numeric < t.min_value
        const maxOut = t.max_value !== null && row.value_numeric > t.max_value
        if (minOut || maxOut) {
          isOor = true
          const sev: ThresholdSeverity = VALID_SEVERITIES.has(
            t.severity as ThresholdSeverity
          )
            ? (t.severity as ThresholdSeverity)
            : "warn"
          oorDetails.push({
            label: row.label_snapshot,
            equipment: row.equipment_name_snapshot,
            value: row.value_numeric,
            unit: row.unit_snapshot,
            min: t.min_value,
            max: t.max_value,
            severity: sev,
          })
        }
      }
    }

    rowsToInsert.push({
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
    })
  }

  // 4) Batch insert all values (if any).
  if (rowsToInsert.length > 0) {
    const { error: valuesErr } = await supabase
      .from("refrigeration_report_values")
      .insert(rowsToInsert)
    if (valuesErr) {
      await supabase.from("refrigeration_reports").delete().eq("id", reportId)
      return {
        ok: false,
        error: dbError(valuesErr, "Failed to save report values."),
      }
    }
  }

  // 5) Optional: bundled out-of-range alert.
  if (oorDetails.length > 0) {
    const { data: settingsRow } = await supabase
      .from("refrigeration_settings")
      .select("out_of_range_alerts_enabled")
      .eq("facility_id", facilityId)
      .maybeSingle()

    if (settingsRow?.out_of_range_alerts_enabled) {
      let topRank = 0
      let topSeverity: ThresholdSeverity = "warn"
      for (const d of oorDetails) {
        const rank = SEVERITY_RANK[d.severity]
        if (rank > topRank) {
          topRank = rank
          topSeverity = d.severity
        }
      }

      const lines = oorDetails.slice(0, 5).map((d) => {
        const unit = d.unit ? ` ${d.unit}` : ""
        const bound =
          d.min !== null && d.value < d.min
            ? `(min ${d.min}${unit})`
            : d.max !== null && d.value > d.max
              ? `(max ${d.max}${unit})`
              : ""
        return `${d.equipment} ${d.label}: ${d.value}${unit} ${bound}`.trim()
      })
      const remainder = oorDetails.length - lines.length
      const bodyParts = [...lines]
      if (remainder > 0) bodyParts.push(`…and ${remainder} more`)

      // Best-effort. Failure does not roll back the report.
      await supabase.from("communication_alerts").insert({
        facility_id: facilityId,
        source_module: "refrigeration",
        source_record_id: reportId,
        severity: topSeverity,
        title: `Refrigeration: ${oorDetails.length} out-of-range reading${
          oorDetails.length === 1 ? "" : "s"
        }`,
        body: bodyParts.join("\n"),
        created_by_employee_id: employeeRow.id,
        requires_acknowledgement: true,
      })
    }
  }

  await dispatchRulesForSubmission({
    facilityId: employeeRow.facility_id,
    sourceModule: "refrigeration",
    sourceRecordId: reportId,
    subject: "Refrigeration report submitted",
  })

  return {
    ok: true,
    redirectTo: `/reports/refrigeration/done?id=${reportId}`,
  }
}

export async function submitRefrigerationReport(
  _prev: SubmissionFormState,
  formData: FormData
): Promise<SubmissionFormState> {
  const result = await performSubmit(formData)
  if (!result.ok) {
    return { error: result.error }
  }
  redirect(result.redirectTo)
}
