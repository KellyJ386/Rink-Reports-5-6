import "server-only"

import React from "react"
import type { SupabaseClient } from "@supabase/supabase-js"

import type { ModulePdfResult } from "../registry"
import {
  ReadingsReportPdf,
  type ReadingRow,
  type ReadingsRecord,
} from "./readings"

type ValueRow = {
  label_snapshot: string
  equipment_name_snapshot: string | null
  field_type_snapshot: "numeric" | "text" | "boolean" | "select"
  unit_snapshot: string | null
  value_text: string | null
  value_numeric: number | string | null
  value_boolean: boolean | null
  is_out_of_range: boolean
  created_at: string
}

function formatValue(v: ValueRow): string {
  switch (v.field_type_snapshot) {
    case "numeric": {
      if (v.value_numeric == null) return "—"
      const n =
        typeof v.value_numeric === "string"
          ? Number(v.value_numeric)
          : v.value_numeric
      const formatted = Number.isFinite(n) ? n.toString() : "—"
      return v.unit_snapshot ? `${formatted} ${v.unit_snapshot}` : formatted
    }
    case "boolean":
      return v.value_boolean === true
        ? "Yes"
        : v.value_boolean === false
          ? "No"
          : "—"
    case "text":
    case "select":
      return v.value_text ?? "—"
    default:
      return v.value_text ?? "—"
  }
}

export async function renderRefrigerationPdf(
  sb: SupabaseClient,
  recordId: string,
): Promise<ModulePdfResult | null> {
  const { data: row } = await sb
    .from("refrigeration_reports")
    .select("id, facility_id, employee_id, notes, submitted_at")
    .eq("id", recordId)
    .maybeSingle()
  if (!row) return null

  const { data: valuesRaw } = await sb
    .from("refrigeration_report_values")
    .select(
      `label_snapshot, equipment_name_snapshot, field_type_snapshot,
       unit_snapshot, value_text, value_numeric, value_boolean,
       is_out_of_range, created_at`,
    )
    .eq("report_id", recordId)
    .order("created_at", { ascending: true })

  const values = (valuesRaw ?? []) as ValueRow[]

  const rows: ReadingRow[] = values.map((v) => ({
    group: v.equipment_name_snapshot ?? "Other",
    label: v.label_snapshot,
    value: formatValue(v),
    flag: v.is_out_of_range
      ? { color: "#b45309", label: "out of range" }
      : null,
  }))

  let submitter: ReadingsRecord["submitter"] = null
  if (row.employee_id) {
    const { data: emp } = await sb
      .from("employees")
      .select("first_name, last_name")
      .eq("id", row.employee_id)
      .maybeSingle()
    if (emp) submitter = { first_name: emp.first_name, last_name: emp.last_name }
  }

  const exceedanceTotal = rows.filter((r) => r.flag).length

  const record: ReadingsRecord = {
    source_module: "refrigeration",
    module_label: "Refrigeration Report",
    id: row.id,
    facility_id: row.facility_id,
    subtitle: null,
    submitted_at: row.submitted_at,
    notes: row.notes,
    submitter,
    exceedance: {
      total: exceedanceTotal,
      max_severity: exceedanceTotal > 0 ? "out_of_range" : null,
    },
    rows,
  }

  return {
    facility_id: record.facility_id,
    document: <ReadingsReportPdf r={record} />,
  }
}
