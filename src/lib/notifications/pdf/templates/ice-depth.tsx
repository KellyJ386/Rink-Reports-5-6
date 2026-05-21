import "server-only"

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer"
import React from "react"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  PdfMetaHeader,
  resolveMetaHeader,
  type PdfMetaHeaderData,
} from "../_components/meta-header"
import {
  PdfRinkDiagram,
  rinkCoords,
  type DiagramPoint,
} from "../_components/rink-diagram"
import type { ModulePdfResult } from "../registry"

// -----------------------------------------------------------------------------
// Data
// -----------------------------------------------------------------------------

type Measurement = {
  point_number: number
  label: string | null
  depth_value: number
  severity: "low" | "ok" | "high"
  x: number
  y: number
}

type IceDepthRecord = {
  id: string
  facility_id: string
  notes: string | null
  submitted_at: string
  unit: "inches" | "mm"
  low_threshold: number
  high_threshold: number
  low_count: number
  high_count: number
  total: number
  layout_name: string | null
  logo_url: string | null
  submitter: { first_name: string; last_name: string } | null
  measurements: Measurement[]
}

async function fetchIceDepthRecord(
  sb: SupabaseClient,
  recordId: string,
): Promise<IceDepthRecord | null> {
  const { data: row } = await sb
    .from("ice_depth_sessions")
    .select(
      `id, facility_id, employee_id, layout_id, notes, submitted_at,
       measurement_unit_snapshot, low_threshold_snapshot, high_threshold_snapshot,
       has_low_reading, has_high_reading, low_count, high_count,
       total_measurements`,
    )
    .eq("id", recordId)
    .maybeSingle()
  if (!row) return null

  // Defence-in-depth: pin facility_id on every secondary lookup so foreign
  // layouts / employees can't leak through even if the parent row were ever
  // malformed.
  let layout_name: string | null = null
  let logo_url: string | null = null
  if (row.layout_id) {
    const { data } = await sb
      .from("ice_depth_layouts")
      .select("name, logo_url")
      .eq("id", row.layout_id)
      .eq("facility_id", row.facility_id)
      .maybeSingle()
    if (data) {
      layout_name = data.name
      logo_url = data.logo_url
    }
  }

  let submitter: IceDepthRecord["submitter"] = null
  if (row.employee_id) {
    const { data } = await sb
      .from("employees")
      .select("first_name, last_name")
      .eq("id", row.employee_id)
      .eq("facility_id", row.facility_id)
      .maybeSingle()
    if (data) submitter = { first_name: data.first_name, last_name: data.last_name }
  }

  const { data: mRowsRaw } = await sb
    .from("ice_depth_measurements")
    .select(
      "point_number_snapshot, label_snapshot, depth_value, severity, x_snapshot, y_snapshot",
    )
    .eq("session_id", recordId)
    .order("point_number_snapshot", { ascending: true })

  const measurements: Measurement[] = (
    (mRowsRaw ?? []) as Array<{
      point_number_snapshot: number
      label_snapshot: string | null
      depth_value: number | string
      severity: Measurement["severity"]
      x_snapshot: number | string
      y_snapshot: number | string
    }>
  ).map((m) => ({
    point_number: m.point_number_snapshot,
    label: m.label_snapshot,
    depth_value:
      typeof m.depth_value === "string"
        ? Number(m.depth_value)
        : m.depth_value,
    severity: m.severity,
    x:
      typeof m.x_snapshot === "string"
        ? Number(m.x_snapshot)
        : m.x_snapshot,
    y:
      typeof m.y_snapshot === "string"
        ? Number(m.y_snapshot)
        : m.y_snapshot,
  }))

  return {
    id: row.id,
    facility_id: row.facility_id,
    notes: row.notes,
    submitted_at: row.submitted_at,
    unit: row.measurement_unit_snapshot,
    low_threshold:
      typeof row.low_threshold_snapshot === "string"
        ? Number(row.low_threshold_snapshot)
        : row.low_threshold_snapshot,
    high_threshold:
      typeof row.high_threshold_snapshot === "string"
        ? Number(row.high_threshold_snapshot)
        : row.high_threshold_snapshot,
    low_count: row.low_count,
    high_count: row.high_count,
    total: row.total_measurements,
    layout_name,
    logo_url,
    submitter,
    measurements,
  }
}

// -----------------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    padding: 40,
    paddingBottom: 60,
    fontSize: 11,
    color: "#0f172a",
    fontFamily: "Helvetica",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1,
    borderBottomColor: "#94a3b8",
    paddingBottom: 12,
    marginBottom: 16,
  },
  headerLeft: { flex: 1 },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  title: { fontSize: 22, fontWeight: 700 },
  subtitle: { fontSize: 12, color: "#475569", marginTop: 2 },
  meta: { fontSize: 9, color: "#64748b", marginTop: 8 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 3,
    fontSize: 10,
    fontWeight: 700,
    color: "#ffffff",
    textTransform: "uppercase",
    marginLeft: 6,
  },
  okChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 3,
    fontSize: 10,
    fontWeight: 700,
    color: "#065f46",
    backgroundColor: "#d1fae5",
    textTransform: "uppercase",
    marginLeft: 6,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 14,
  },
  summaryCell: {
    width: "33%",
    paddingVertical: 6,
    paddingRight: 12,
  },
  summaryLabel: {
    fontSize: 9,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: 700,
    color: "#0f172a",
    marginTop: 2,
  },
  section: { marginBottom: 14 },
  sectionLabel: {
    fontSize: 10,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  body: { fontSize: 11, lineHeight: 1.45, color: "#0f172a" },
  legendRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 10,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 10,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 5,
  },
  legendLabel: {
    fontSize: 9,
    color: "#475569",
  },
  footer: {
    position: "absolute",
    left: 40,
    right: 40,
    bottom: 24,
    fontSize: 8,
    color: "#94a3b8",
    textAlign: "center",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 6,
  },
})

const SEVERITY_COLOR: Record<Measurement["severity"], string> = {
  low: "#dc2626", // red
  ok: "#16a34a", // green
  high: "#eab308", // yellow
}

function fmtTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function fmtDepth(v: number, unit: "inches" | "mm"): string {
  if (!Number.isFinite(v)) return "—"
  const decimals = unit === "inches" ? 2 : 1
  return `${v.toFixed(decimals)} ${unit === "inches" ? '"' : "mm"}`
}

function IceDepthPdf({
  r,
  meta,
}: {
  r: IceDepthRecord
  meta: PdfMetaHeaderData
}) {
  const submitterName = r.submitter
    ? `${r.submitter.first_name} ${r.submitter.last_name}`
    : "—"

  const hasExceedance = r.low_count > 0 || r.high_count > 0

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <PdfMetaHeader data={meta} />
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>Ice Depth Session</Text>
            <Text style={styles.subtitle}>
              {r.layout_name ?? "Layout"}
            </Text>
            <Text style={styles.meta}>
              Submitted {fmtTs(r.submitted_at)} · Record {r.id}
            </Text>
          </View>
          <View style={styles.headerRight}>
            {r.high_count > 0 ? (
              <Text style={{ ...styles.chip, backgroundColor: SEVERITY_COLOR.high, color: "#422006" }}>
                {r.high_count} HIGH
              </Text>
            ) : null}
            {r.low_count > 0 ? (
              <Text style={{ ...styles.chip, backgroundColor: SEVERITY_COLOR.low }}>
                {r.low_count} LOW
              </Text>
            ) : null}
            {!hasExceedance ? <Text style={styles.okChip}>All OK</Text> : null}
          </View>
        </View>

        <View style={styles.summaryGrid}>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Measurements</Text>
            <Text style={styles.summaryValue}>{r.total}</Text>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Low threshold</Text>
            <Text style={styles.summaryValue}>
              {fmtDepth(r.low_threshold, r.unit)}
            </Text>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>High threshold</Text>
            <Text style={styles.summaryValue}>
              {fmtDepth(r.high_threshold, r.unit)}
            </Text>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Unit</Text>
            <Text style={styles.summaryValue}>{r.unit}</Text>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Submitter</Text>
            <Text style={styles.summaryValue}>{submitterName}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            Rink diagram ({r.measurements.length} measurements, depth in{" "}
            {r.unit === "inches" ? "inches" : "mm"})
          </Text>
          {r.measurements.length === 0 ? (
            <Text style={{ fontSize: 10, color: "#94a3b8", padding: 8 }}>
              No measurements captured for this session.
            </Text>
          ) : (
            <View style={{ alignItems: "center", marginTop: 6 }}>
              <PdfRinkDiagram
                points={r.measurements.map((m): DiagramPoint => {
                  const { cx, cy } = rinkCoords(m.x, m.y)
                  return {
                    cx,
                    cy,
                    depth_value: m.depth_value,
                    severity: m.severity,
                  }
                })}
                unit={r.unit}
                logoUrl={r.logo_url}
                width={320}
              />
              <View style={styles.legendRow}>
                <View style={styles.legendItem}>
                  <View style={{ ...styles.legendDot, backgroundColor: "#16a34a" }} />
                  <Text style={styles.legendLabel}>OK</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={{ ...styles.legendDot, backgroundColor: "#dc2626" }} />
                  <Text style={styles.legendLabel}>Low</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={{ ...styles.legendDot, backgroundColor: "#eab308" }} />
                  <Text style={styles.legendLabel}>High</Text>
                </View>
              </View>
            </View>
          )}
        </View>

        {r.notes ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Notes</Text>
            <Text style={styles.body}>{r.notes}</Text>
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          Generated by Rink Reports · ice_depth ·{" "}
          {new Date().toLocaleString()}
        </Text>
      </Page>
    </Document>
  )
}

// -----------------------------------------------------------------------------
// Template entry
// -----------------------------------------------------------------------------

export async function renderIceDepthPdf(
  sb: SupabaseClient,
  recordId: string,
): Promise<ModulePdfResult | null> {
  const record = await fetchIceDepthRecord(sb, recordId)
  if (!record) return null
  const submitterName = record.submitter
    ? `${record.submitter.first_name} ${record.submitter.last_name}`
    : "—"
  const meta = await resolveMetaHeader(
    record.facility_id,
    record.submitted_at,
    submitterName,
  )
  return {
    facility_id: record.facility_id,
    document: <IceDepthPdf r={record} meta={meta} />,
  }
}
