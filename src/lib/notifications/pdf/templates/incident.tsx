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

import type { ModulePdfResult } from "../registry"

// -----------------------------------------------------------------------------
// Data
// -----------------------------------------------------------------------------

type Chip = {
  display_name: string
  color: string | null
  key?: string | null
}

type IncidentRecord = {
  id: string
  facility_id: string
  location: string | null
  occurred_at: string
  reporter_name: string
  reporter_phone: string
  description: string
  status: "submitted" | "reviewed" | "resolved" | "archived"
  submitted_at: string
  reviewed_at: string | null
  resolved_at: string | null
  archived_at: string | null
  type: Chip | null
  severity: Chip | null
  submitter: { first_name: string; last_name: string } | null
}

async function fetchIncidentRecord(
  sb: SupabaseClient,
  recordId: string,
): Promise<IncidentRecord | null> {
  const { data: row } = await sb
    .from("incident_reports")
    .select(
      `id, facility_id, employee_id, incident_type_id, severity_level_id,
       location, occurred_at, reporter_name, reporter_phone, description,
       status, submitted_at, reviewed_at, resolved_at, archived_at`,
    )
    .eq("id", recordId)
    .maybeSingle()
  if (!row) return null

  // Defence-in-depth: every secondary lookup is pinned to the report's
  // facility so a malformed parent row pointing at a foreign-facility
  // type / severity / employee can't leak into the rendered PDF.
  let type: Chip | null = null
  if (row.incident_type_id) {
    const { data } = await sb
      .from("incident_types")
      .select("name, color, slug")
      .eq("id", row.incident_type_id)
      .eq("facility_id", row.facility_id)
      .maybeSingle()
    if (data) type = { display_name: data.name, color: data.color, key: data.slug }
  }

  let severity: Chip | null = null
  if (row.severity_level_id) {
    const { data } = await sb
      .from("incident_severity_levels")
      .select("display_name, color, key")
      .eq("id", row.severity_level_id)
      .eq("facility_id", row.facility_id)
      .maybeSingle()
    if (data) severity = { display_name: data.display_name, color: data.color, key: data.key }
  }

  let submitter: IncidentRecord["submitter"] = null
  if (row.employee_id) {
    const { data } = await sb
      .from("employees")
      .select("first_name, last_name")
      .eq("id", row.employee_id)
      .eq("facility_id", row.facility_id)
      .maybeSingle()
    if (data) submitter = { first_name: data.first_name, last_name: data.last_name }
  }

  return {
    id: row.id,
    facility_id: row.facility_id,
    location: row.location,
    occurred_at: row.occurred_at,
    reporter_name: row.reporter_name,
    reporter_phone: row.reporter_phone,
    description: row.description,
    status: row.status,
    submitted_at: row.submitted_at,
    reviewed_at: row.reviewed_at,
    resolved_at: row.resolved_at,
    archived_at: row.archived_at,
    type,
    severity,
    submitter,
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
    marginLeft: 12,
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
  section: { marginBottom: 14 },
  sectionLabel: {
    fontSize: 10,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  row: { flexDirection: "row", marginBottom: 4 },
  rowLabel: { width: 130, color: "#475569" },
  rowValue: { flex: 1, color: "#0f172a" },
  body: { fontSize: 11, lineHeight: 1.45, color: "#0f172a" },
  timeline: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 2,
  },
  timelineStep: {
    flexDirection: "row",
    alignItems: "center",
  },
  timelineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#94a3b8",
    marginRight: 5,
  },
  timelineDotDone: {
    backgroundColor: "#0f172a",
  },
  timelineLabel: { fontSize: 9, color: "#475569" },
  timelineDate: { fontSize: 9, color: "#94a3b8", marginLeft: 4 },
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

function chipColor(c: Chip | null, fallbackByKey?: string): string {
  if (c?.color && /^#[0-9a-f]{6}$/i.test(c.color)) return c.color
  const key = (c?.key ?? fallbackByKey ?? "").toLowerCase()
  if (key === "critical") return "#9f1239"
  if (key === "high") return "#c2410c"
  if (key === "medium" || key === "warn" || key === "moderate") return "#b45309"
  if (key === "low") return "#475569"
  if (key === "info") return "#1e3a8a"
  return "#475569"
}

function fmt(iso: string | null): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function statusOrder(): Array<{
  key: IncidentRecord["status"]
  label: string
}> {
  return [
    { key: "submitted", label: "Submitted" },
    { key: "reviewed", label: "Reviewed" },
    { key: "resolved", label: "Resolved" },
    { key: "archived", label: "Archived" },
  ]
}

function statusReached(
  current: IncidentRecord["status"],
  step: IncidentRecord["status"],
): boolean {
  const order = ["submitted", "reviewed", "resolved", "archived"]
  return order.indexOf(current) >= order.indexOf(step)
}

function IncidentReportPdf({ r }: { r: IncidentRecord }) {
  const submitterName = r.submitter
    ? `${r.submitter.first_name} ${r.submitter.last_name}`
    : "—"

  const timelineDates: Record<IncidentRecord["status"], string | null> = {
    submitted: r.submitted_at,
    reviewed: r.reviewed_at,
    resolved: r.resolved_at,
    archived: r.archived_at,
  }

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>Incident Report</Text>
            <Text style={styles.subtitle}>
              {r.type?.display_name ?? "Uncategorised incident"}
            </Text>
            <Text style={styles.meta}>
              Submitted {fmt(r.submitted_at)} · Record {r.id}
            </Text>
          </View>
          <View style={styles.headerRight}>
            {r.type ? (
              <Text style={{ ...styles.chip, backgroundColor: chipColor(r.type) }}>
                {r.type.display_name}
              </Text>
            ) : null}
            {r.severity ? (
              <Text
                style={{
                  ...styles.chip,
                  backgroundColor: chipColor(r.severity),
                }}
              >
                {r.severity.display_name}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Status</Text>
          <View style={styles.timeline}>
            {statusOrder().map((step) => {
              const reached = statusReached(r.status, step.key)
              const date = timelineDates[step.key]
              return (
                <View key={step.key} style={styles.timelineStep}>
                  <View
                    style={
                      reached
                        ? { ...styles.timelineDot, ...styles.timelineDotDone }
                        : styles.timelineDot
                    }
                  />
                  <Text
                    style={{
                      ...styles.timelineLabel,
                      color: reached ? "#0f172a" : "#94a3b8",
                      fontWeight: reached ? 700 : 400,
                    }}
                  >
                    {step.label}
                  </Text>
                  {date ? (
                    <Text style={styles.timelineDate}>· {fmt(date)}</Text>
                  ) : null}
                </View>
              )
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>When &amp; Where</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Occurred at</Text>
            <Text style={styles.rowValue}>{fmt(r.occurred_at)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Location</Text>
            <Text style={styles.rowValue}>{r.location ?? "—"}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Reporter Contact</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Name</Text>
            <Text style={styles.rowValue}>{r.reporter_name}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Phone</Text>
            <Text style={styles.rowValue}>{r.reporter_phone}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Logged by</Text>
            <Text style={styles.rowValue}>{submitterName}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Description</Text>
          <Text style={styles.body}>{r.description}</Text>
        </View>

        <Text style={styles.footer} fixed>
          Generated by Rink Reports · incident_reports ·{" "}
          {new Date().toLocaleString()}
        </Text>
      </Page>
    </Document>
  )
}

// -----------------------------------------------------------------------------
// Template entry
// -----------------------------------------------------------------------------

export async function renderIncidentReportPdf(
  sb: SupabaseClient,
  recordId: string,
): Promise<ModulePdfResult | null> {
  const record = await fetchIncidentRecord(sb, recordId)
  if (!record) return null
  return {
    facility_id: record.facility_id,
    document: <IncidentReportPdf r={record} />,
  }
}
