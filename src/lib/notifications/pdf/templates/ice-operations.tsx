import "server-only"

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer"
import React from "react"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  PdfMetaHeader,
  resolveMetaHeader,
  type PdfMetaHeaderData,
} from "../_components/meta-header"
import { formatPdfGeneratedAt, formatPdfTimestamp } from "../format"
import type { ModulePdfResult } from "../registry"

// -----------------------------------------------------------------------------
// Data
//
// Ice Operations was the last submission module with no PDF template, so an
// attached report fell back to the generic flat label/value layout. That
// rendering could show the payload fields, but two things it structurally
// could not: the per-item circle-check results (reduced to "Failed checks: N")
// and the follow-up note thread. Both are the parts an operator actually reads,
// so they are the reason this template exists.
// -----------------------------------------------------------------------------

const OPERATION_LABELS: Record<string, string> = {
  ice_make: "Ice Make",
  circle_check: "Circle Check",
  edging: "Edging",
  blade_change: "Blade Change",
  propane_tank_change: "Propane Tank Change",
}

type CheckResult = {
  label: string
  passed: boolean
  failed_notes: string | null
}

type FollowupNote = {
  body: string
  created_at: string
  author: string | null
  is_admin_note: boolean
}

type IceOperationsRecord = {
  id: string
  facility_id: string
  operation_type: string
  occurred_at: string
  submitted_at: string
  notes: string | null
  failed_count: number
  has_failed_check: boolean
  payload: Record<string, unknown>
  rinkName: string | null
  equipmentName: string | null
  submitter: string | null
  checks: CheckResult[]
  followups: FollowupNote[]
}

async function fetchIceOperationsRecord(
  sb: SupabaseClient,
  recordId: string,
): Promise<IceOperationsRecord | null> {
  const { data: row } = await sb
    .from("ice_operations_submissions")
    .select(
      `id, facility_id, employee_id, equipment_id, rink_id, operation_type,
       occurred_at, submitted_at, payload, notes, failed_count, has_failed_check`,
    )
    .eq("id", recordId)
    .maybeSingle()
  if (!row) return null

  // Defence-in-depth: every secondary lookup is pinned to the submission's
  // facility, so a malformed parent row pointing at a foreign-facility rink,
  // machine, or employee cannot leak into the rendered PDF.
  let rinkName: string | null = null
  if (row.rink_id) {
    const { data } = await sb
      .from("ice_operations_rinks")
      .select("name")
      .eq("id", row.rink_id)
      .eq("facility_id", row.facility_id)
      .maybeSingle()
    rinkName = data?.name ?? null
  }

  let equipmentName: string | null = null
  if (row.equipment_id) {
    const { data } = await sb
      .from("ice_operations_equipment")
      .select("name")
      .eq("id", row.equipment_id)
      .eq("facility_id", row.facility_id)
      .maybeSingle()
    equipmentName = data?.name ?? null
  }

  let submitter: string | null = null
  if (row.employee_id) {
    const { data } = await sb
      .from("employees")
      .select("first_name, last_name")
      .eq("id", row.employee_id)
      .eq("facility_id", row.facility_id)
      .maybeSingle()
    if (data) submitter = `${data.first_name} ${data.last_name}`.trim()
  }

  // Circle-check results. label_snapshot is denormalized at submit time, so a
  // later rename of the catalog item never rewrites history.
  const { data: checkRows } = await sb
    .from("ice_operations_circle_check_results")
    .select("label_snapshot, passed, failed_notes")
    .eq("submission_id", row.id)
  const checks: CheckResult[] = (
    (checkRows ?? []) as Array<{
      label_snapshot: string | null
      passed: boolean
      failed_notes: string | null
    }>
  ).map((c) => ({
    label: c.label_snapshot ?? "—",
    passed: c.passed,
    failed_notes: c.failed_notes,
  }))
  // Failures first — the reason someone opens this report at all.
  checks.sort((a, b) => Number(a.passed) - Number(b.passed))

  const { data: noteRows } = await sb
    .from("ice_operations_followup_notes")
    .select("body, created_at, employee_id, is_admin_note")
    .eq("submission_id", row.id)
    .order("created_at", { ascending: true })
  const noteAuthorIds = Array.from(
    new Set(
      ((noteRows ?? []) as Array<{ employee_id: string | null }>)
        .map((n) => n.employee_id)
        .filter((v): v is string => !!v),
    ),
  )
  const authorById = new Map<string, string>()
  if (noteAuthorIds.length > 0) {
    const { data } = await sb
      .from("employees")
      .select("id, first_name, last_name")
      .eq("facility_id", row.facility_id)
      .in("id", noteAuthorIds)
    for (const e of (data ?? []) as Array<{
      id: string
      first_name: string
      last_name: string
    }>) {
      authorById.set(e.id, `${e.first_name} ${e.last_name}`.trim())
    }
  }
  const followups: FollowupNote[] = (
    (noteRows ?? []) as Array<{
      body: string
      created_at: string
      employee_id: string | null
      is_admin_note: boolean
    }>
  ).map((n) => ({
    body: n.body,
    created_at: n.created_at,
    author: n.employee_id ? (authorById.get(n.employee_id) ?? null) : null,
    is_admin_note: n.is_admin_note,
  }))

  return {
    id: row.id,
    facility_id: row.facility_id,
    operation_type: row.operation_type,
    occurred_at: row.occurred_at,
    submitted_at: row.submitted_at,
    notes: row.notes,
    failed_count: row.failed_count,
    has_failed_check: row.has_failed_check,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    rinkName,
    equipmentName,
    submitter,
    checks,
    followups,
  }
}

/**
 * Operation-specific detail rows. Mirrors the branches in snapshotIceOperations
 * so the bespoke and fallback renderings never disagree about what a given
 * operation records.
 */
function detailRows(
  r: IceOperationsRecord,
): Array<{ label: string; value: string }> {
  const p = r.payload
  const num = (v: unknown): string | null => (v == null ? null : String(v))
  const out: Array<{ label: string; value: string | null }> = []

  switch (r.operation_type) {
    case "ice_make":
      out.push(
        { label: "Water temp", value: p.water_temp_c == null ? null : `${p.water_temp_c} °C` },
        { label: "Ice temp", value: p.ice_temp_c == null ? null : `${p.ice_temp_c} °C` },
        { label: "Time in", value: (p.time_in as string | null) ?? null },
        { label: "Time out", value: (p.time_out as string | null) ?? null },
        { label: "Water used (gal)", value: num(p.water_used_gal) },
        { label: "Surface passes", value: num(p.surface_pass_count) },
        {
          label: "Propane tank changed",
          value: p.propane_tank_changed === true ? "Yes" : null,
        },
      )
      break
    case "edging":
      out.push({ label: "Hours run", value: num(p.hours_run) })
      break
    case "blade_change":
      out.push(
        { label: "Blade serial", value: (p.blade_serial as string | null) ?? null },
        { label: "Hours at change", value: num(p.hours_at_change) },
      )
      break
    case "propane_tank_change":
      out.push({ label: "Machine hours", value: num(p.hours_at_change) })
      break
    case "circle_check":
      out.push({
        label: "Failed checks",
        value: r.has_failed_check ? String(r.failed_count) : "None",
      })
      break
  }

  return out.filter((x): x is { label: string; value: string } => x.value != null)
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
  headerRight: { flexDirection: "row", alignItems: "center", marginLeft: 12 },
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
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingVertical: 4,
  },
  checkStatus: {
    width: 46,
    fontSize: 9,
    fontWeight: 700,
    textTransform: "uppercase",
  },
  checkPass: { color: "#15803d" },
  checkFail: { color: "#b91c1c" },
  checkLabel: { flex: 1, color: "#0f172a" },
  checkNote: {
    fontSize: 9,
    color: "#b91c1c",
    marginTop: 2,
  },
  note: {
    borderLeftWidth: 2,
    borderLeftColor: "#cbd5e1",
    paddingLeft: 8,
    marginBottom: 8,
  },
  noteMeta: { fontSize: 9, color: "#64748b", marginBottom: 2 },
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

function IceOperationsPdf({
  r,
  meta,
}: {
  r: IceOperationsRecord
  meta: PdfMetaHeaderData
}) {
  const opLabel = OPERATION_LABELS[r.operation_type] ?? r.operation_type
  const rows = detailRows(r)
  const failed = r.checks.filter((c) => !c.passed).length

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <PdfMetaHeader data={meta} />

        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>Ice Operations</Text>
            <Text style={styles.subtitle}>
              {opLabel}
              {r.rinkName ? ` · ${r.rinkName}` : ""}
              {r.equipmentName ? ` · ${r.equipmentName}` : ""}
            </Text>
            <Text style={styles.meta}>
              Submitted {formatPdfTimestamp(r.submitted_at, meta.timeZone)} ·
              Record {r.id}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={{ ...styles.chip, backgroundColor: "#475569" }}>
              {opLabel}
            </Text>
            {failed > 0 ? (
              <Text style={{ ...styles.chip, backgroundColor: "#b91c1c" }}>
                {failed} failed
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Log</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Occurred at</Text>
            <Text style={styles.rowValue}>
              {formatPdfTimestamp(r.occurred_at, meta.timeZone)}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Submitter</Text>
            <Text style={styles.rowValue}>{r.submitter ?? "—"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Rink</Text>
            <Text style={styles.rowValue}>{r.rinkName ?? "—"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Equipment</Text>
            <Text style={styles.rowValue}>{r.equipmentName ?? "—"}</Text>
          </View>
        </View>

        {rows.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{opLabel} details</Text>
            {rows.map((d) => (
              <View key={d.label} style={styles.row}>
                <Text style={styles.rowLabel}>{d.label}</Text>
                <Text style={styles.rowValue}>{d.value}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {r.checks.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>
              Circle check ({r.checks.length - failed}/{r.checks.length} passed)
            </Text>
            {r.checks.map((c, i) => (
              <View key={`${c.label}-${i}`} style={styles.checkRow} wrap={false}>
                <Text
                  style={
                    c.passed
                      ? { ...styles.checkStatus, ...styles.checkPass }
                      : { ...styles.checkStatus, ...styles.checkFail }
                  }
                >
                  {c.passed ? "Pass" : "Fail"}
                </Text>
                <View style={styles.checkLabel}>
                  <Text>{c.label}</Text>
                  {!c.passed && c.failed_notes ? (
                    <Text style={styles.checkNote}>{c.failed_notes}</Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {r.notes ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Notes</Text>
            <Text style={styles.body}>{r.notes}</Text>
          </View>
        ) : null}

        {r.followups.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Follow-up</Text>
            {r.followups.map((n, i) => (
              <View key={i} style={styles.note} wrap={false}>
                <Text style={styles.noteMeta}>
                  {n.author ?? "Unknown"}
                  {n.is_admin_note ? " (admin)" : ""} ·{" "}
                  {formatPdfTimestamp(n.created_at, meta.timeZone)}
                </Text>
                <Text style={styles.body}>{n.body}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          Generated by Rink Reports · ice_operations ·{" "}
          {formatPdfGeneratedAt(new Date(), meta.timeZone)}
        </Text>
      </Page>
    </Document>
  )
}

// -----------------------------------------------------------------------------
// Template entry
// -----------------------------------------------------------------------------

export async function renderIceOperationsPdf(
  sb: SupabaseClient,
  recordId: string,
): Promise<ModulePdfResult | null> {
  const record = await fetchIceOperationsRecord(sb, recordId)
  if (!record) return null
  const meta = await resolveMetaHeader(
    record.facility_id,
    record.submitted_at,
    record.submitter ?? "—",
  )
  return {
    facility_id: record.facility_id,
    document: <IceOperationsPdf r={record} meta={meta} />,
  }
}
