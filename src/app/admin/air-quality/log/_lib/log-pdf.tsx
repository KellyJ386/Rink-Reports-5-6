import "server-only"

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer"
import React from "react"
import type { SupabaseClient } from "@supabase/supabase-js"

import type { AirQualityFormData } from "@/app/reports/air-quality/types"

const styles = StyleSheet.create({
  page: {
    padding: 28,
    fontSize: 9,
    color: "#0f172a",
    fontFamily: "Helvetica",
  },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 10, color: "#475569", marginBottom: 2 },
  meta: { fontSize: 9, color: "#64748b", marginBottom: 12 },
  table: { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 2 },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  th: {
    backgroundColor: "#f1f5f9",
    fontWeight: 700,
    padding: 4,
    fontSize: 8,
  },
  td: { padding: 4, fontSize: 8 },
  exceed: { color: "#b91c1c", fontWeight: 700 },
  footer: {
    position: "absolute",
    left: 28,
    right: 28,
    bottom: 16,
    fontSize: 7,
    color: "#94a3b8",
    textAlign: "center",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 4,
  },
})

// Column widths (flex units) — keep in sync between header and body.
const COLS = [
  { key: "date", label: "Date", w: 1.3 },
  { key: "time", label: "Time", w: 0.9 },
  { key: "location", label: "Location", w: 1.6 },
  { key: "type", label: "Type", w: 1.2 },
  { key: "co", label: "CO (ppm)", w: 1 },
  { key: "no2", label: "NO₂ (ppm)", w: 1 },
  { key: "alert", label: "Alert level", w: 1.2 },
  { key: "calib", label: "Monitor cal.", w: 1.8 },
  { key: "by", label: "Recorded by", w: 1.5 },
] as const

type LogRow = {
  date: string
  time: string
  location: string
  type: string
  co: string
  coExceed: boolean
  no2: string
  no2Exceed: boolean
  alert: string
  calib: string
  by: string
}

function isCo(key: string, label: string): boolean {
  const k = key.toLowerCase()
  if (k.includes("co2")) return false
  if (k === "co" || k.startsWith("co_")) return true
  return /carbon monoxide/i.test(label)
}
function isNo2(key: string, label: string): boolean {
  const k = key.toLowerCase()
  if (k.includes("no2")) return true
  return /nitrogen dioxide|nitrogen/i.test(label)
}
function asNum(v: number | string | null): number | null {
  if (v == null) return null
  const n = typeof v === "string" ? Number(v) : v
  return Number.isFinite(n) ? n : null
}

function readingKindLabel(kind: string | undefined): string {
  switch (kind) {
    case "post_resurfacing":
      return "Post-resurfacing"
    case "post_edging":
      return "Post-edging"
    case "routine":
      return "Routine"
    default:
      return "—"
  }
}

function calibText(fd: AirQualityFormData | null): string {
  if (!fd?.equipment) return "—"
  const parts: string[] = []
  if (fd.equipment.co_monitor?.calibration_date)
    parts.push(`CO ${fd.equipment.co_monitor.calibration_date}`)
  if (fd.equipment.no2_monitor?.calibration_date)
    parts.push(`NO₂ ${fd.equipment.no2_monitor.calibration_date}`)
  return parts.length ? parts.join("; ") : "—"
}

export type LogPdfResult = { buffer: Buffer; filename: string }

/**
 * Build an inspector-ready Air Quality monitoring-log PDF for a facility over a
 * date range. Mirrors the on-screen admin log but adds the jurisdiction header
 * and the computed alert level per reading. All queries are facility-pinned and
 * run through the caller's RLS-scoped client.
 */
export async function buildAirQualityLogPdf(
  supabase: SupabaseClient,
  facilityId: string,
  from: string,
  to: string,
): Promise<LogPdfResult | null> {
  const toBound = new Date(`${to}T00:00:00Z`)
  toBound.setUTCDate(toBound.getUTCDate() + 1)

  const [{ data: facility }, { data: configRow }, { data: reportsRaw }] =
    await Promise.all([
      supabase
        .from("facilities")
        .select("name, timezone")
        .eq("id", facilityId)
        .maybeSingle(),
      supabase
        .from("facility_air_quality_config")
        .select("compliance_profile_id")
        .eq("facility_id", facilityId)
        .maybeSingle(),
      supabase
        .from("air_quality_reports")
        .select(
          "id, employee_id, equipment_id, location_id, submitted_at, has_exceedance, max_severity, form_data",
        )
        .eq("facility_id", facilityId)
        .gte("submitted_at", `${from}T00:00:00Z`)
        .lt("submitted_at", toBound.toISOString())
        .order("submitted_at", { ascending: true }),
    ])

  let jurisdiction: string | null = null
  if (configRow?.compliance_profile_id) {
    const { data: profile } = await supabase
      .from("air_quality_compliance_profiles")
      .select("display_name")
      .eq("id", configRow.compliance_profile_id)
      .maybeSingle()
    jurisdiction = profile?.display_name ?? null
  }

  type ReportRow = {
    id: string
    employee_id: string | null
    equipment_id: string | null
    location_id: string | null
    submitted_at: string
    has_exceedance: boolean
    max_severity: string | null
    form_data: AirQualityFormData | null
  }
  const reports = (reportsRaw ?? []) as ReportRow[]
  const reportIds = reports.map((r) => r.id)
  const employeeIds = [
    ...new Set(reports.map((r) => r.employee_id).filter((v): v is string => !!v)),
  ]
  const locationIds = [
    ...new Set(reports.map((r) => r.location_id).filter((v): v is string => !!v)),
  ]

  const [empRes, locRes, readRes] = await Promise.all([
    employeeIds.length
      ? supabase
          .from("employees")
          .select("id, first_name, last_name")
          .in("id", employeeIds)
      : Promise.resolve({ data: [] as Array<{ id: string; first_name: string | null; last_name: string | null }> }),
    locationIds.length
      ? supabase.from("facility_spaces").select("id, name").in("id", locationIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    reportIds.length
      ? supabase
          .from("air_quality_readings")
          .select("report_id, key_snapshot, label_snapshot, value_numeric, is_exceedance")
          .in("report_id", reportIds)
      : Promise.resolve({
          data: [] as Array<{
            report_id: string
            key_snapshot: string
            label_snapshot: string
            value_numeric: number | string
            is_exceedance: boolean
          }>,
        }),
  ])

  const empName = new Map(
    (empRes.data ?? []).map((e) => [
      e.id,
      [e.first_name, e.last_name].filter(Boolean).join(" ").trim() || "—",
    ]),
  )
  const locName = new Map((locRes.data ?? []).map((l) => [l.id, l.name]))

  type Rd = { value_numeric: number | string; is_exceedance: boolean }
  const coBy = new Map<string, Rd>()
  const no2By = new Map<string, Rd>()
  for (const r of readRes.data ?? []) {
    if (isCo(r.key_snapshot, r.label_snapshot) && !coBy.has(r.report_id)) {
      coBy.set(r.report_id, r)
    } else if (isNo2(r.key_snapshot, r.label_snapshot) && !no2By.has(r.report_id)) {
      no2By.set(r.report_id, r)
    }
  }

  const tz = facility?.timezone || "UTC"
  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(
        new Date(iso),
      )
    } catch {
      return iso
    }
  }

  const rows: LogRow[] = reports.map((r) => {
    const co = coBy.get(r.id)
    const no2 = no2By.get(r.id)
    const coNum = co ? asNum(co.value_numeric) : null
    const no2Num = no2 ? asNum(no2.value_numeric) : null
    const alert =
      r.form_data?.compliance?.overall_alert_level ??
      (r.has_exceedance ? (r.max_severity ?? "exceedance") : "within")
    return {
      date: fmt(r.submitted_at, { year: "numeric", month: "short", day: "2-digit" }),
      time: fmt(r.submitted_at, { hour: "numeric", minute: "2-digit" }),
      location: r.location_id ? (locName.get(r.location_id) ?? "—") : "—",
      type: readingKindLabel(r.form_data?.compliance?.reading_kind),
      co: coNum == null ? "—" : String(coNum),
      coExceed: co?.is_exceedance ?? false,
      no2: no2Num == null ? "—" : String(no2Num),
      no2Exceed: no2?.is_exceedance ?? false,
      alert,
      calib: calibText(r.form_data),
      by: r.employee_id ? (empName.get(r.employee_id) ?? "—") : "—",
    }
  })

  const doc = (
    <Document>
      <Page size="LETTER" orientation="landscape" style={styles.page}>
        <Text style={styles.title}>Air Quality Monitoring Log</Text>
        <Text style={styles.subtitle}>
          {facility?.name ?? "Facility"}
          {jurisdiction ? ` · Jurisdiction: ${jurisdiction}` : ""}
        </Text>
        <Text style={styles.meta}>
          {from} – {to} · CO and NO₂ in ppm · {rows.length} reading
          {rows.length === 1 ? "" : "s"}
        </Text>

        <View style={styles.table}>
          <View style={[styles.tr, { backgroundColor: "#f1f5f9" }]} fixed>
            {COLS.map((c) => (
              <Text key={c.key} style={[styles.th, { flex: c.w }]}>
                {c.label}
              </Text>
            ))}
          </View>
          {rows.map((row, i) => (
            <View key={i} style={styles.tr} wrap={false}>
              <Text style={[styles.td, { flex: COLS[0].w }]}>{row.date}</Text>
              <Text style={[styles.td, { flex: COLS[1].w }]}>{row.time}</Text>
              <Text style={[styles.td, { flex: COLS[2].w }]}>{row.location}</Text>
              <Text style={[styles.td, { flex: COLS[3].w }]}>{row.type}</Text>
              <Text
                style={[styles.td, { flex: COLS[4].w }, row.coExceed ? styles.exceed : {}]}
              >
                {row.co}
              </Text>
              <Text
                style={[styles.td, { flex: COLS[5].w }, row.no2Exceed ? styles.exceed : {}]}
              >
                {row.no2}
              </Text>
              <Text
                style={[
                  styles.td,
                  { flex: COLS[6].w },
                  row.alert !== "within" ? styles.exceed : {},
                ]}
              >
                {row.alert}
              </Text>
              <Text style={[styles.td, { flex: COLS[7].w }]}>{row.calib}</Text>
              <Text style={[styles.td, { flex: COLS[8].w }]}>{row.by}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.footer} fixed>
          Generated by Rink Reports · {new Date().toLocaleString()} · Reports are
          immutable; this log reflects the readings as recorded.
        </Text>
      </Page>
    </Document>
  )

  const buffer = await renderToBuffer(doc)
  return { buffer, filename: `air-quality-log-${from}_to_${to}.pdf` }
}
