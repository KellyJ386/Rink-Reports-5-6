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

type ItemRow = {
  label: string
  checked: boolean
}

type NoteRow = {
  body: string
  is_admin_note: boolean
  created_at: string
  author: string | null
}

type DailyRecord = {
  id: string
  facility_id: string
  submitted_at: string
  area_name: string | null
  area_color: string | null
  template_name: string | null
  template_description: string | null
  submitter: { first_name: string; last_name: string } | null
  items: ItemRow[]
  notes: NoteRow[]
}

async function fetchDailyRecord(
  sb: SupabaseClient,
  recordId: string,
): Promise<DailyRecord | null> {
  const { data: row } = await sb
    .from("daily_report_submissions")
    .select("id, facility_id, area_id, template_id, employee_id, submitted_at")
    .eq("id", recordId)
    .maybeSingle()
  if (!row) return null

  // Defence-in-depth: every secondary lookup pinned to the submission's
  // facility so foreign areas / templates / employees can't surface.
  let area_name: string | null = null
  let area_color: string | null = null
  if (row.area_id) {
    const { data } = await sb
      .from("daily_report_areas")
      .select("name, color")
      .eq("id", row.area_id)
      .eq("facility_id", row.facility_id)
      .maybeSingle()
    if (data) {
      area_name = data.name
      area_color = data.color
    }
  }

  let template_name: string | null = null
  let template_description: string | null = null
  if (row.template_id) {
    const { data } = await sb
      .from("daily_report_templates")
      .select("name, description")
      .eq("id", row.template_id)
      .eq("facility_id", row.facility_id)
      .maybeSingle()
    if (data) {
      template_name = data.name
      template_description = data.description
    }
  }

  let submitter: DailyRecord["submitter"] = null
  if (row.employee_id) {
    const { data } = await sb
      .from("employees")
      .select("first_name, last_name")
      .eq("id", row.employee_id)
      .eq("facility_id", row.facility_id)
      .maybeSingle()
    if (data) submitter = { first_name: data.first_name, last_name: data.last_name }
  }

  const { data: itemRowsRaw } = await sb
    .from("daily_report_submission_items")
    .select("label_snapshot, is_checked, created_at")
    .eq("submission_id", recordId)
    .order("created_at", { ascending: true })

  const items: ItemRow[] = (
    (itemRowsRaw ?? []) as Array<{ label_snapshot: string; is_checked: boolean }>
  ).map((r) => ({ label: r.label_snapshot, checked: r.is_checked }))

  // Notes: at submit time only the staff-authored note (is_admin_note=false)
  // is meaningful. Admin notes accumulate later and aren't part of the
  // original submission PDF — but we still render them when present so a
  // re-rendered PDF (manual super_admin trigger) reflects current state.
  const { data: noteRowsRaw } = await sb
    .from("daily_report_notes")
    .select("body, is_admin_note, created_at, employee_id")
    .eq("submission_id", recordId)
    .order("created_at", { ascending: true })

  const noteEmployeeIds = Array.from(
    new Set(
      ((noteRowsRaw ?? []) as Array<{ employee_id: string | null }>)
        .map((n) => n.employee_id)
        .filter((x): x is string => !!x),
    ),
  )
  const { data: noteEmpsRaw } = noteEmployeeIds.length
    ? await sb
        .from("employees")
        .select("id, first_name, last_name")
        .eq("facility_id", row.facility_id)
        .in("id", noteEmployeeIds)
    : { data: [] }
  const empById = new Map(
    ((noteEmpsRaw ?? []) as Array<{
      id: string
      first_name: string
      last_name: string
    }>).map((e) => [e.id, `${e.first_name} ${e.last_name}`]),
  )

  const notes: NoteRow[] = (
    (noteRowsRaw ?? []) as Array<{
      body: string
      is_admin_note: boolean
      created_at: string
      employee_id: string | null
    }>
  ).map((n) => ({
    body: n.body,
    is_admin_note: n.is_admin_note,
    created_at: n.created_at,
    author: n.employee_id ? empById.get(n.employee_id) ?? null : null,
  }))

  return {
    id: row.id,
    facility_id: row.facility_id,
    submitted_at: row.submitted_at,
    area_name,
    area_color,
    template_name,
    template_description,
    submitter,
    items,
    notes,
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
  title: { fontSize: 22, fontWeight: 700 },
  subtitle: { fontSize: 13, color: "#475569", marginTop: 2 },
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
  progressBar: {
    height: 8,
    backgroundColor: "#e2e8f0",
    borderRadius: 3,
    overflow: "hidden",
    marginVertical: 6,
  },
  progressFill: {
    height: 8,
    backgroundColor: "#0f172a",
  },
  progressLabel: {
    fontSize: 9,
    color: "#64748b",
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
  itemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e2e8f0",
  },
  checkBox: {
    width: 12,
    height: 12,
    borderWidth: 1,
    borderColor: "#475569",
    marginTop: 1,
    marginRight: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  checkBoxFilled: {
    backgroundColor: "#0f172a",
    borderColor: "#0f172a",
  },
  checkMark: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: 700,
    lineHeight: 1,
  },
  itemLabel: { flex: 1, fontSize: 11 },
  itemLabelUnchecked: { color: "#64748b" },
  noteCard: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 3,
    padding: 8,
    marginBottom: 6,
    backgroundColor: "#f8fafc",
  },
  noteHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  noteAuthor: {
    fontSize: 9,
    fontWeight: 700,
    color: "#475569",
  },
  noteBadge: {
    fontSize: 8,
    fontWeight: 700,
    textTransform: "uppercase",
    color: "#ffffff",
    backgroundColor: "#7c3aed",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 2,
    marginLeft: 6,
  },
  noteDate: { fontSize: 9, color: "#94a3b8" },
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

function fmt(iso: string | null): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function safeColor(color: string | null, fallback: string): string {
  if (color && /^#[0-9a-f]{6}$/i.test(color)) return color
  return fallback
}

function DailyReportPdf({ r }: { r: DailyRecord }) {
  const submitterName = r.submitter
    ? `${r.submitter.first_name} ${r.submitter.last_name}`
    : "—"

  const total = r.items.length
  const completed = r.items.filter((i) => i.checked).length
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>Daily Report</Text>
            <Text style={styles.subtitle}>
              {r.template_name ?? "Template"}
            </Text>
            <Text style={styles.meta}>
              Submitted {fmt(r.submitted_at)} · Submitter {submitterName} ·
              Record {r.id}
            </Text>
          </View>
          {r.area_name ? (
            <Text
              style={{
                ...styles.chip,
                backgroundColor: safeColor(r.area_color, "#475569"),
              }}
            >
              {r.area_name}
            </Text>
          ) : null}
        </View>

        {r.template_description ? (
          <View style={styles.section}>
            <Text style={styles.body}>{r.template_description}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            Checklist ({completed} of {total} completed · {pct}%)
          </Text>
          <View style={styles.progressBar}>
            <View
              style={{ ...styles.progressFill, width: `${pct}%` as `${number}%` }}
            />
          </View>

          {r.items.length === 0 ? (
            <Text style={{ fontSize: 10, color: "#94a3b8", padding: 6 }}>
              No checklist items recorded for this submission.
            </Text>
          ) : (
            r.items.map((item, i) => (
              <View key={i} style={styles.itemRow}>
                <View
                  style={
                    item.checked
                      ? { ...styles.checkBox, ...styles.checkBoxFilled }
                      : styles.checkBox
                  }
                >
                  {item.checked ? (
                    <Text style={styles.checkMark}>✓</Text>
                  ) : null}
                </View>
                <Text
                  style={
                    item.checked
                      ? styles.itemLabel
                      : { ...styles.itemLabel, ...styles.itemLabelUnchecked }
                  }
                >
                  {item.label}
                </Text>
              </View>
            ))
          )}
        </View>

        {r.notes.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Notes</Text>
            {r.notes.map((n, i) => (
              <View key={i} style={styles.noteCard}>
                <View style={styles.noteHeader}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text style={styles.noteAuthor}>
                      {n.author ?? "Unknown"}
                    </Text>
                    {n.is_admin_note ? (
                      <Text style={styles.noteBadge}>admin follow-up</Text>
                    ) : null}
                  </View>
                  <Text style={styles.noteDate}>{fmt(n.created_at)}</Text>
                </View>
                <Text style={styles.body}>{n.body}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          Generated by Rink Reports · daily_reports ·{" "}
          {new Date().toLocaleString()}
        </Text>
      </Page>
    </Document>
  )
}

// -----------------------------------------------------------------------------
// Template entry
// -----------------------------------------------------------------------------

export async function renderDailyReportPdf(
  sb: SupabaseClient,
  recordId: string,
): Promise<ModulePdfResult | null> {
  const record = await fetchDailyRecord(sb, recordId)
  if (!record) return null
  return {
    facility_id: record.facility_id,
    document: <DailyReportPdf r={record} />,
  }
}
