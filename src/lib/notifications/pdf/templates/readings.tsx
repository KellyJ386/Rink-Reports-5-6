import "server-only"

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer"
import React from "react"

import { PdfMetaHeader, type PdfMetaHeaderData } from "../_components/meta-header"

// -----------------------------------------------------------------------------
// Shared shape — refrigeration and air_quality both reduce to this.
// -----------------------------------------------------------------------------

export type ReadingRow = {
  /** Section / equipment / category for grouping. Null = "Other". */
  group: string | null
  label: string
  /** Pre-formatted display string e.g. "12.5 PSI" or "Yes" or text body. */
  value: string
  /** Optional out-of-band flag (out-of-range / exceedance). */
  flag: { color: string; label: string } | null
}

export type ReadingsExceedanceSummary = {
  total: number
  max_severity: "warn" | "high" | "critical" | "out_of_range" | null
}

export type ReadingsRecord = {
  source_module: string
  module_label: string // shown in the title
  id: string
  facility_id: string
  subtitle: string | null
  submitted_at: string
  notes: string | null
  submitter: { first_name: string; last_name: string } | null
  exceedance: ReadingsExceedanceSummary
  rows: ReadingRow[]
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
  headerRight: { flexDirection: "row", alignItems: "center" },
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
  groupHeader: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    color: "#475569",
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginTop: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
  },
  tr: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e2e8f0",
    paddingHorizontal: 6,
    alignItems: "center",
  },
  trFlagged: { backgroundColor: "#fff7ed" },
  td: { fontSize: 11 },
  colLabel: { flex: 2, color: "#0f172a" },
  colValue: { flex: 1, textAlign: "right", color: "#0f172a", paddingRight: 8 },
  colFlag: { width: 90 },
  flagPill: {
    fontSize: 9,
    fontWeight: 700,
    textTransform: "uppercase",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 3,
    color: "#ffffff",
    alignSelf: "flex-end",
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

const SEVERITY_COLOR: Record<
  NonNullable<ReadingsExceedanceSummary["max_severity"]>,
  string
> = {
  out_of_range: "#b45309",
  warn: "#b45309",
  high: "#c2410c",
  critical: "#9f1239",
}

const SEVERITY_LABEL: Record<
  NonNullable<ReadingsExceedanceSummary["max_severity"]>,
  string
> = {
  out_of_range: "out of range",
  warn: "warn",
  high: "high",
  critical: "critical",
}

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function groupRows(
  rows: ReadingRow[],
): Array<{ group: string; rows: ReadingRow[] }> {
  const map = new Map<string, ReadingRow[]>()
  for (const row of rows) {
    const key = row.group ?? "Other"
    const list = map.get(key) ?? []
    list.push(row)
    map.set(key, list)
  }
  // Stable order: insertion order preserved by Map.
  return Array.from(map.entries()).map(([group, rs]) => ({ group, rows: rs }))
}

export function ReadingsReportPdf({
  r,
  meta,
}: {
  r: ReadingsRecord
  meta: PdfMetaHeaderData
}) {
  const submitterName = r.submitter
    ? `${r.submitter.first_name} ${r.submitter.last_name}`
    : "—"

  const sev = r.exceedance.max_severity
  const grouped = groupRows(r.rows)

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <PdfMetaHeader data={meta} />
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>{r.module_label}</Text>
            {r.subtitle ? (
              <Text style={styles.subtitle}>{r.subtitle}</Text>
            ) : null}
            <Text style={styles.meta}>
              Submitted {fmt(r.submitted_at)} · Submitter {submitterName} ·
              Record {r.id}
            </Text>
          </View>
          <View style={styles.headerRight}>
            {r.exceedance.total > 0 && sev ? (
              <Text
                style={{
                  ...styles.chip,
                  backgroundColor: SEVERITY_COLOR[sev],
                }}
              >
                {r.exceedance.total} {SEVERITY_LABEL[sev]}
              </Text>
            ) : (
              <Text style={styles.okChip}>All in range</Text>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Readings</Text>
          {grouped.length === 0 ? (
            <Text style={{ fontSize: 10, color: "#94a3b8", padding: 6 }}>
              No values captured for this report.
            </Text>
          ) : (
            grouped.map((g, gi) => (
              <View key={gi}>
                <Text style={styles.groupHeader}>{g.group}</Text>
                {g.rows.map((row, ri) => (
                  <View
                    key={ri}
                    style={
                      row.flag
                        ? { ...styles.tr, ...styles.trFlagged }
                        : styles.tr
                    }
                  >
                    <Text style={{ ...styles.td, ...styles.colLabel }}>
                      {row.label}
                    </Text>
                    <Text style={{ ...styles.td, ...styles.colValue }}>
                      {row.value}
                    </Text>
                    <View style={styles.colFlag}>
                      {row.flag ? (
                        <Text
                          style={{
                            ...styles.flagPill,
                            backgroundColor: row.flag.color,
                          }}
                        >
                          {row.flag.label}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            ))
          )}
        </View>

        {r.notes ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Notes</Text>
            <Text style={styles.body}>{r.notes}</Text>
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          Generated by Rink Reports · {r.source_module} ·{" "}
          {new Date().toLocaleString()}
        </Text>
      </Page>
    </Document>
  )
}

// Re-exported for the per-module adapters.
export { SEVERITY_COLOR as READINGS_SEVERITY_COLOR }
