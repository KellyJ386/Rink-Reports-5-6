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
import type { ModulePdfResult } from "../registry"

// -----------------------------------------------------------------------------
// Data shape
// -----------------------------------------------------------------------------

type DropdownLite = {
  id: string
  category: string | null
  display_name: string | null
  key: string | null
  color: string | null
  metadata: Record<string, unknown> | null
}

type BodyPart = {
  display_name: string
  side: "front" | "back" | "both" | "none"
  laterality: "left" | "right" | null
  notes: string | null
}

type Witness = {
  name: string
  contact: string | null
  statement: string | null
}

type AccidentRecord = {
  id: string
  facility_id: string
  injured_person_name: string
  injured_person_contact: string | null
  injured_person_age: number | null
  description: string
  occurred_at: string
  submitted_at: string
  workers_comp: boolean
  workers_comp_acknowledged_at: string | null
  location: DropdownLite | null
  activity: DropdownLite | null
  severity: DropdownLite | null
  medical_attention: DropdownLite | null
  primary_injury_type: DropdownLite | null
  submitter: { first_name: string; last_name: string } | null
  body_parts: BodyPart[]
  witnesses: Witness[]
}

// -----------------------------------------------------------------------------
// Fetch
// -----------------------------------------------------------------------------

async function fetchAccidentRecord(
  sb: SupabaseClient,
  recordId: string,
): Promise<AccidentRecord | null> {
  const { data: row } = await sb
    .from("accident_reports")
    .select(
      `id, facility_id, employee_id, injured_person_name, injured_person_contact,
       injured_person_age,
       description, occurred_at, submitted_at, workers_comp,
       workers_comp_acknowledged_at,
       location_dropdown_id, activity_dropdown_id, severity_dropdown_id,
       medical_attention_dropdown_id, primary_injury_type_dropdown_id`,
    )
    .eq("id", recordId)
    .maybeSingle()
  if (!row) return null

  const dropdownIds = [
    row.location_dropdown_id,
    row.activity_dropdown_id,
    row.severity_dropdown_id,
    row.medical_attention_dropdown_id,
    row.primary_injury_type_dropdown_id,
  ].filter((id): id is string => !!id)

  // Defence-in-depth: pin facility_id on every secondary lookup so even a
  // malformed parent row pointing at a foreign-facility dropdown can't leak
  // the foreign display_name / color into this tenant's PDF.
  const { data: dropdownsRaw } = dropdownIds.length
    ? await sb
        .from("accident_dropdowns")
        .select("id, category, display_name, key, color, metadata")
        .eq("facility_id", row.facility_id)
        .in("id", dropdownIds)
    : { data: [] }

  const byId = new Map(
    ((dropdownsRaw ?? []) as DropdownLite[]).map((d) => [d.id, d]),
  )

  // Body parts: join to dropdowns for display_name. `laterality` (migration
  // 00000000000092) isn't in the generated Database types yet — cast.
  const { data: bodyRows } = await sb
    .from("accident_body_part_selections")
    .select("body_part_dropdown_id, side, laterality, notes")
    .eq("accident_id", recordId)

  const bodyDropdownIds = ((bodyRows ?? []) as Array<{
    body_part_dropdown_id: string
  }>).map((b) => b.body_part_dropdown_id)

  const { data: bodyDropdownsRaw } = bodyDropdownIds.length
    ? await sb
        .from("accident_dropdowns")
        .select("id, display_name")
        .eq("facility_id", row.facility_id)
        .in("id", bodyDropdownIds)
    : { data: [] }

  const bodyDropdownById = new Map(
    ((bodyDropdownsRaw ?? []) as Array<{
      id: string
      display_name: string
    }>).map((d) => [d.id, d.display_name]),
  )

  const body_parts: BodyPart[] = ((bodyRows ?? []) as Array<{
    body_part_dropdown_id: string
    side: BodyPart["side"]
    laterality: string | null
    notes: string | null
  }>).map((b) => ({
    display_name:
      bodyDropdownById.get(b.body_part_dropdown_id) ?? "(unknown body part)",
    side: b.side,
    laterality:
      b.laterality === "left" || b.laterality === "right" ? b.laterality : null,
    notes: b.notes,
  }))

  // Witnesses (0..5). Defence-in-depth: pin facility_id to match the parent
  // report's facility so a malformed row can't leak a foreign witness.
  // accident_witnesses isn't in the generated Database types yet -- cast
  // through `any`, matching the pattern in offline-sync/route.ts.
  const { data: witnessRowsRaw } = await sb
    .from("accident_witnesses")
    .select("name, contact, statement, sort_order")
    .eq("accident_id", recordId)
    .eq("facility_id", row.facility_id)
    .order("sort_order", { ascending: true })

  const witnesses: Witness[] = ((witnessRowsRaw ?? []) as Array<{
    name: string
    contact: string | null
    statement: string | null
  }>).map((w) => ({
    name: w.name,
    contact: w.contact,
    statement: w.statement,
  }))

  let submitter: AccidentRecord["submitter"] = null
  if (row.employee_id) {
    const { data: emp } = await sb
      .from("employees")
      .select("first_name, last_name")
      .eq("id", row.employee_id)
      .eq("facility_id", row.facility_id)
      .maybeSingle()
    if (emp) submitter = { first_name: emp.first_name, last_name: emp.last_name }
  }

  return {
    id: row.id,
    facility_id: row.facility_id,
    injured_person_name: row.injured_person_name,
    injured_person_contact: row.injured_person_contact,
    // injured_person_age isn't in the generated Database types yet; cast.
    injured_person_age:
      typeof (row as { injured_person_age?: number | null })
        .injured_person_age === "number"
        ? (row as { injured_person_age: number }).injured_person_age
        : null,
    description: row.description,
    occurred_at: row.occurred_at,
    submitted_at: row.submitted_at,
    workers_comp: row.workers_comp,
    workers_comp_acknowledged_at: row.workers_comp_acknowledged_at,
    location: row.location_dropdown_id
      ? byId.get(row.location_dropdown_id) ?? null
      : null,
    activity: row.activity_dropdown_id
      ? byId.get(row.activity_dropdown_id) ?? null
      : null,
    severity: row.severity_dropdown_id
      ? byId.get(row.severity_dropdown_id) ?? null
      : null,
    medical_attention: row.medical_attention_dropdown_id
      ? byId.get(row.medical_attention_dropdown_id) ?? null
      : null,
    primary_injury_type: row.primary_injury_type_dropdown_id
      ? byId.get(row.primary_injury_type_dropdown_id) ?? null
      : null,
    submitter,
    body_parts,
    witnesses,
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
  severityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 3,
    fontSize: 10,
    fontWeight: 700,
    color: "#ffffff",
    textTransform: "uppercase",
    marginLeft: 12,
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
  rowLabel: { width: 140, color: "#475569" },
  rowValue: { flex: 1, color: "#0f172a" },
  body: { fontSize: 11, lineHeight: 1.45, color: "#0f172a" },
  table: {
    borderTopWidth: 1,
    borderTopColor: "#cbd5e1",
    marginTop: 2,
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingVertical: 5,
  },
  trHead: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
  },
  th: {
    fontSize: 9,
    color: "#475569",
    fontWeight: 700,
    textTransform: "uppercase",
  },
  td: { fontSize: 10, paddingHorizontal: 4 },
  thBody: { flex: 2 },
  thSide: { flex: 1 },
  thNotes: { flex: 3 },
  wcBox: {
    marginTop: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 3,
    backgroundColor: "#f8fafc",
  },
  witnessBlock: {
    marginBottom: 6,
    padding: 6,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 3,
    backgroundColor: "#f8fafc",
  },
  witnessHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  witnessName: { fontSize: 10, fontWeight: 700, color: "#0f172a" },
  witnessContact: { fontSize: 9, color: "#475569" },
  witnessStatement: {
    fontSize: 10,
    color: "#0f172a",
    lineHeight: 1.4,
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

function severityColor(d: DropdownLite | null): string {
  if (d?.color && /^#[0-9a-f]{6}$/i.test(d.color)) return d.color
  const key = d?.key?.toLowerCase() ?? ""
  if (key === "critical") return "#9f1239"
  if (key === "high") return "#c2410c"
  if (key === "warn" || key === "medium" || key === "moderate") return "#b45309"
  if (key === "low") return "#475569"
  return "#475569"
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function sideLabel(side: BodyPart["side"]): string {
  switch (side) {
    case "front":
      return "Front"
    case "back":
      return "Back"
    case "both":
      return "Front & Back"
    case "none":
    default:
      return "—"
  }
}

function AccidentReportPdf({
  r,
  meta,
}: {
  r: AccidentRecord
  meta: PdfMetaHeaderData
}) {
  const submitterName = r.submitter
    ? `${r.submitter.first_name} ${r.submitter.last_name}`
    : "—"

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <PdfMetaHeader data={meta} />
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>Accident Report</Text>
            <Text style={styles.subtitle}>{r.injured_person_name}</Text>
            <Text style={styles.meta}>
              Submitted {fmtDateTime(r.submitted_at)} · Record {r.id}
            </Text>
          </View>
          {r.severity ? (
            <Text
              style={{
                ...styles.severityBadge,
                backgroundColor: severityColor(r.severity),
              }}
            >
              {r.severity.display_name ?? r.severity.key ?? "severity"}
            </Text>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Injured Person</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Name</Text>
            <Text style={styles.rowValue}>{r.injured_person_name}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Contact</Text>
            <Text style={styles.rowValue}>{r.injured_person_contact ?? "—"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Age</Text>
            <Text style={styles.rowValue}>
              {r.injured_person_age === null ? "—" : String(r.injured_person_age)}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>When &amp; Where</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Occurred at</Text>
            <Text style={styles.rowValue}>{fmtDateTime(r.occurred_at)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Location</Text>
            <Text style={styles.rowValue}>
              {r.location?.display_name ?? "—"}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Activity</Text>
            <Text style={styles.rowValue}>
              {r.activity?.display_name ?? "—"}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Injury Assessment</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Primary injury type</Text>
            <Text style={styles.rowValue}>
              {r.primary_injury_type?.display_name ?? "—"}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Medical attention</Text>
            <Text style={styles.rowValue}>
              {r.medical_attention?.display_name ?? "—"}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Submitter</Text>
            <Text style={styles.rowValue}>{submitterName}</Text>
          </View>
        </View>

        {r.body_parts.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Affected Body Parts</Text>
            <View style={styles.trHead}>
              <Text style={{ ...styles.th, ...styles.thBody }}>Body part</Text>
              <Text style={{ ...styles.th, ...styles.thSide }}>Side</Text>
              <Text style={{ ...styles.th, ...styles.thNotes }}>Notes</Text>
            </View>
            <View style={styles.table}>
              {r.body_parts.map((b, i) => {
                const prefix =
                  b.laterality === "left"
                    ? "Left "
                    : b.laterality === "right"
                      ? "Right "
                      : ""
                return (
                  <View key={i} style={styles.tr}>
                    <Text style={{ ...styles.td, ...styles.thBody }}>
                      {`${prefix}${b.display_name}`}
                    </Text>
                    <Text style={{ ...styles.td, ...styles.thSide }}>
                      {sideLabel(b.side)}
                    </Text>
                    <Text style={{ ...styles.td, ...styles.thNotes }}>
                      {b.notes ?? "—"}
                    </Text>
                  </View>
                )
              })}
            </View>
          </View>
        ) : null}

        {r.witnesses.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>
              Witnesses ({r.witnesses.length})
            </Text>
            {r.witnesses.map((w, i) => (
              <View key={i} style={styles.witnessBlock} wrap={false}>
                <View style={styles.witnessHeader}>
                  <Text style={styles.witnessName}>{w.name}</Text>
                  {w.contact ? (
                    <Text style={styles.witnessContact}>{w.contact}</Text>
                  ) : null}
                </View>
                {w.statement ? (
                  <Text style={styles.witnessStatement}>{w.statement}</Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Description</Text>
          <Text style={styles.body}>{r.description}</Text>
        </View>

        <View style={styles.wcBox}>
          <Text style={{ fontSize: 10, fontWeight: 700 }}>
            Workers&apos; compensation:{" "}
            {r.workers_comp ? "REPORTED" : "Not reported"}
          </Text>
          {r.workers_comp_acknowledged_at ? (
            <Text style={{ fontSize: 9, color: "#475569", marginTop: 2 }}>
              Acknowledged {fmtDateTime(r.workers_comp_acknowledged_at)}
            </Text>
          ) : null}
        </View>

        <Text style={styles.footer} fixed>
          Generated by Rink Reports · accident_reports ·{" "}
          {new Date().toLocaleString()}
        </Text>
      </Page>
    </Document>
  )
}

// -----------------------------------------------------------------------------
// Template entry
// -----------------------------------------------------------------------------

export async function renderAccidentReportPdf(
  sb: SupabaseClient,
  recordId: string,
): Promise<ModulePdfResult | null> {
  const record = await fetchAccidentRecord(sb, recordId)
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
    document: <AccidentReportPdf r={record} meta={meta} />,
  }
}
