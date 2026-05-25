import "server-only"

import React from "react"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  ARENA_STATUS_OPTIONS,
  ELECTRIC_EQUIPMENT_OPTIONS,
  FUEL_TYPE_OPTIONS,
  VENTILATION_STATUS_OPTIONS,
  type AirQualityFormData,
  type AirQualityMeasurement,
} from "@/app/reports/air-quality/types"

import { resolveMetaHeader } from "../_components/meta-header"
import type { ModulePdfResult } from "../registry"
import {
  READINGS_SEVERITY_COLOR,
  ReadingsReportPdf,
  type ReadingRow,
  type ReadingsExceedanceSummary,
  type ReadingsRecord,
} from "./readings"

type ReadingDb = {
  label_snapshot: string
  unit_snapshot: string
  value_numeric: number | string
  is_exceedance: boolean
  severity_at_submit: "warn" | "high" | "critical" | null
  compliance_min_at_submit: number | string | null
  compliance_max_at_submit: number | string | null
  created_at: string
}

function asNum(v: number | string | null): number | null {
  if (v == null) return null
  const n = typeof v === "string" ? Number(v) : v
  return Number.isFinite(n) ? n : null
}

function formatReading(r: ReadingDb): string {
  const n = asNum(r.value_numeric)
  if (n == null) return "—"
  return r.unit_snapshot ? `${n} ${r.unit_snapshot}` : String(n)
}

function labelFor(
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string | null,
): string {
  if (!value) return value ?? ""
  return options.find((o) => o.value === value)?.label ?? value
}

function measurementValue(m: AirQualityMeasurement): string {
  const parts: string[] = []
  if (m.co != null) parts.push(`CO ${m.co} ppm`)
  if (m.no2 != null) parts.push(`NO2 ${m.no2} ppm`)
  if (m.temperature != null) parts.push(`${m.temperature}°F`)
  if (m.note) parts.push(m.note)
  return parts.join(" · ") || "—"
}

function measurementLabel(m: AirQualityMeasurement): string {
  return [m.location, m.time].filter(Boolean).join(" @ ") || "Measurement"
}

function formDataRows(value: unknown): ReadingRow[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  const fd = value as AirQualityFormData
  const out: ReadingRow[] = []
  const push = (group: string, label: string, v: string | null) => {
    if (v && v.trim() !== "") out.push({ group, label, value: v, flag: null })
  }

  const eqGroup = "Tester & Equipment"
  push(eqGroup, "Date of test", fd.date_of_test)
  push(eqGroup, "Tester certification", fd.tester_certification)
  const co = fd.equipment?.co_monitor
  if (co)
    push(
      eqGroup,
      "CO monitor",
      [co.type, co.model, co.calibration_date && `cal ${co.calibration_date}`]
        .filter(Boolean)
        .join(" · ") || null,
    )
  const no2 = fd.equipment?.no2_monitor
  if (no2)
    push(
      eqGroup,
      "NO2 monitor",
      [no2.type, no2.model, no2.calibration_date && `cal ${no2.calibration_date}`]
        .filter(Boolean)
        .join(" · ") || null,
    )
  push(
    eqGroup,
    "Ventilation last inspection",
    fd.equipment?.ventilation_last_inspection ?? null,
  )

  const s1 = fd.section1
  if (s1) {
    const g = "Section 1 — General"
    push(g, "Arena status", labelFor(ARENA_STATUS_OPTIONS, s1.arena_status) || null)
    push(
      g,
      "Ventilation status",
      labelFor(VENTILATION_STATUS_OPTIONS, s1.ventilation_status) || null,
    )
    ;(s1.resurfacers ?? []).forEach((r, i) => {
      push(
        g,
        `Resurfacer ${i + 1}`,
        [r.make_model, labelFor(FUEL_TYPE_OPTIONS, r.fuel_type)]
          .filter(Boolean)
          .join(" · ") || null,
      )
    })
    ;(s1.other_equipment ?? []).forEach((r, i) => {
      push(
        g,
        `Other equipment ${i + 1}`,
        [r.name, labelFor(FUEL_TYPE_OPTIONS, r.fuel_type)]
          .filter(Boolean)
          .join(" · ") || null,
      )
    })
    push(g, "Maintenance · resurfacers", s1.maintenance?.resurfacers ?? null)
    push(g, "Maintenance · ventilation", s1.maintenance?.ventilation ?? null)
    push(g, "Maintenance · other", s1.maintenance?.other ?? null)
  }

  ;(fd.section2?.routine ?? []).forEach((m) => {
    push("Section 2 — Routine", measurementLabel(m), measurementValue(m))
  })
  ;(fd.section2?.post_edging ?? []).forEach((m) => {
    push("Section 2 — Post-Edging", measurementLabel(m), measurementValue(m))
  })

  const s4 = fd.section4
  if (s4) {
    const g = "Section 4 — Recommendations"
    push(
      g,
      "Electric equipment",
      labelFor(ELECTRIC_EQUIPMENT_OPTIONS, s4.electric_equipment_consideration) ||
        null,
    )
    push(g, "Staff trained", s4.staff_trained ? "Yes" : null)
    push(g, "Public signage present", s4.public_signage ? "Yes" : null)
    push(g, "Unusual observations", s4.unusual_observations)
  }

  return out
}

function severityRank(
  s: NonNullable<ReadingsExceedanceSummary["max_severity"]>,
): number {
  switch (s) {
    case "critical":
      return 3
    case "high":
      return 2
    default:
      return 1
  }
}

export async function renderAirQualityPdf(
  sb: SupabaseClient,
  recordId: string,
): Promise<ModulePdfResult | null> {
  const { data: row } = await sb
    .from("air_quality_reports")
    .select(
      `id, facility_id, employee_id, location_id, equipment_id, notes,
       submitted_at, has_exceedance, max_severity, form_data`,
    )
    .eq("id", recordId)
    .maybeSingle()
  if (!row) return null

  // Defence-in-depth: pin facility_id on every secondary lookup.
  let location_name: string | null = null
  if (row.location_id) {
    const { data } = await sb
      .from("air_quality_locations")
      .select("name")
      .eq("id", row.location_id)
      .eq("facility_id", row.facility_id)
      .maybeSingle()
    if (data) location_name = data.name
  }

  let equipment_name: string | null = null
  if (row.equipment_id) {
    const { data } = await sb
      .from("air_quality_equipment")
      .select("name")
      .eq("id", row.equipment_id)
      .eq("facility_id", row.facility_id)
      .maybeSingle()
    if (data) equipment_name = data.name
  }

  const subtitle = [location_name, equipment_name]
    .filter(Boolean)
    .join(" · ") || null

  const { data: readingsRaw } = await sb
    .from("air_quality_readings")
    .select(
      `label_snapshot, unit_snapshot, value_numeric, is_exceedance,
       severity_at_submit, compliance_min_at_submit, compliance_max_at_submit,
       created_at`,
    )
    .eq("report_id", recordId)
    .order("created_at", { ascending: true })

  const readings = (readingsRaw ?? []) as ReadingDb[]

  const rows: ReadingRow[] = readings.map((reading) => {
    const min = asNum(reading.compliance_min_at_submit)
    const max = asNum(reading.compliance_max_at_submit)
    const range =
      min != null && max != null
        ? `range ${min}–${max} ${reading.unit_snapshot}`
        : min != null
          ? `min ${min} ${reading.unit_snapshot}`
          : max != null
            ? `max ${max} ${reading.unit_snapshot}`
            : null

    return {
      group: range ? `Compliance ${range}` : "Other",
      label: reading.label_snapshot,
      value: formatReading(reading),
      flag:
        reading.is_exceedance && reading.severity_at_submit
          ? {
              color: READINGS_SEVERITY_COLOR[reading.severity_at_submit],
              label: reading.severity_at_submit,
            }
          : null,
    }
  })

  let submitter: ReadingsRecord["submitter"] = null
  if (row.employee_id) {
    const { data: emp } = await sb
      .from("employees")
      .select("first_name, last_name")
      .eq("id", row.employee_id)
      .eq("facility_id", row.facility_id)
      .maybeSingle()
    if (emp) submitter = { first_name: emp.first_name, last_name: emp.last_name }
  }

  // Trust the report-level max_severity when present; else compute.
  const reportSeverity =
    (row.max_severity as ReadingsExceedanceSummary["max_severity"]) ?? null
  let computedMax: ReadingsExceedanceSummary["max_severity"] = reportSeverity
  if (!computedMax) {
    for (const reading of readings) {
      if (
        reading.is_exceedance &&
        reading.severity_at_submit &&
        (!computedMax ||
          severityRank(reading.severity_at_submit) > severityRank(computedMax))
      ) {
        computedMax = reading.severity_at_submit
      }
    }
  }

  rows.push(...formDataRows(row.form_data))

  const exceedanceTotal = readings.filter((r) => r.is_exceedance).length

  const record: ReadingsRecord = {
    source_module: "air_quality",
    module_label: "Air Quality Report",
    id: row.id,
    facility_id: row.facility_id,
    subtitle,
    submitted_at: row.submitted_at,
    notes: row.notes,
    submitter,
    exceedance: { total: exceedanceTotal, max_severity: computedMax },
    rows,
  }

  const submitterName = submitter
    ? `${submitter.first_name} ${submitter.last_name}`
    : "—"
  const meta = await resolveMetaHeader(
    record.facility_id,
    record.submitted_at,
    submitterName,
  )

  return {
    facility_id: record.facility_id,
    document: <ReadingsReportPdf r={record} meta={meta} />,
  }
}
