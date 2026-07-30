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
import { formatAssetLabel } from "@/app/reports/dasher-boards/_lib/glass-numbering"
import { resolveRinkGlassNumbers } from "@/app/reports/dasher-boards/_lib/queries"

// -----------------------------------------------------------------------------
// Data
// -----------------------------------------------------------------------------

type IssueSeverity = "a" | "b" | "c"

const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  a: "A — Safety critical",
  b: "B — Needs repair",
  c: "C — Cosmetic",
}

const ASSET_TYPE_LABEL: Record<string, string> = {
  board_panel: "Board",
  door: "Door",
  glass_panel: "Glass",
}

type AssetCheckLine = {
  label: string
  asset_type: string
  status: "pass" | "fail"
  note: string | null
}

type IssueLine = {
  asset_label: string | null
  category: string | null
  severity: IssueSeverity
  description: string
}

type ChecklistLine = {
  label: string
  status: "pass" | "flag"
}

type DasherBoardsRecord = {
  id: string
  facility_id: string
  rink_name: string | null
  facility_name: string | null
  notes: string | null
  started_at: string
  completed_at: string | null
  inspector: { first_name: string; last_name: string } | null
  checks: AssetCheckLine[]
  issues: IssueLine[]
  checklist: ChecklistLine[]
}

async function fetchDasherBoardsRecord(
  sb: SupabaseClient,
  recordId: string,
): Promise<DasherBoardsRecord | null> {
  const { data: row } = await sb
    .from("dasher_boards_inspections")
    .select(
      "id, facility_id, rink_id, inspector_id, notes, started_at, completed_at",
    )
    .eq("id", recordId)
    .maybeSingle()
  if (!row) return null

  // Defence-in-depth: pin facility_id on every secondary lookup so foreign
  // rinks / employees / lookup rows can't leak through even if the parent
  // row were ever malformed (same pattern as the ice-depth template).
  const [rinkRes, facilityRes, checksRes, issuesRes, responsesRes] =
    await Promise.all([
      sb
        .from("dasher_boards_rinks")
        .select(
          "name, glass_numbering_enabled, glass_number_prefix, glass_number_start, glass_number_direction, glass_number_anchor_offset, glass_number_include_doors, perimeter_direction, perimeter_anchor_offset",
        )
        .eq("id", row.rink_id)
        .eq("facility_id", row.facility_id)
        .maybeSingle(),
      sb.from("facilities").select("name").eq("id", row.facility_id).maybeSingle(),
      sb
        .from("dasher_boards_asset_checks")
        .select("asset_id, status, note")
        .eq("inspection_id", recordId)
        .eq("facility_id", row.facility_id),
      sb
        .from("dasher_boards_issues")
        .select("asset_id, category_id, severity, description, created_at")
        .eq("inspection_id", recordId)
        .eq("facility_id", row.facility_id)
        .order("created_at", { ascending: true }),
      sb
        .from("dasher_boards_checklist_responses")
        .select("item_id, status")
        .eq("inspection_id", recordId)
        .eq("facility_id", row.facility_id),
    ])

  let inspector: DasherBoardsRecord["inspector"] = null
  if (row.inspector_id) {
    const { data } = await sb
      .from("employees")
      .select("first_name, last_name")
      .eq("id", row.inspector_id)
      .eq("facility_id", row.facility_id)
      .maybeSingle()
    if (data) {
      inspector = { first_name: data.first_name, last_name: data.last_name }
    }
  }

  // Perimeter asset labels (walk order: positioned assets by
  // sequence_position, glass rows ride along by label) + issue categories +
  // checklist item labels — all label lookups for the id-only rows above.
  const [assetsRes, categoriesRes, itemsRes] = await Promise.all([
    sb
      .from("dasher_boards_assets")
      .select(
        "id, label, asset_type, sequence_position, is_active, parent_board_id, display_number",
      )
      .eq("rink_id", row.rink_id)
      .eq("facility_id", row.facility_id)
      .order("sequence_position", { ascending: true, nullsFirst: false })
      .order("label", { ascending: true }),
    sb
      .from("dasher_boards_issue_categories")
      .select("id, label")
      .eq("facility_id", row.facility_id),
    sb
      .from("dasher_boards_checklist_items")
      .select("id, label, sort_order")
      .eq("rink_id", row.rink_id)
      .eq("facility_id", row.facility_id)
      .order("sort_order", { ascending: true }),
  ])

  type AssetRow = {
    id: string
    label: string
    asset_type: string
    sequence_position: number | null
    is_active: boolean
    parent_board_id: string | null
    display_number: string | null
  }
  const assets = (assetsRes.data ?? []) as AssetRow[]
  const assetById = new Map(assets.map((a) => [a.id, a]))
  const assetOrder = new Map(assets.map((a, i) => [a.id, i]))

  // The rink's own glass numbering, so the printed walk reads in the numbers
  // the crew used on the floor. Empty when the rink hasn't enabled it, which
  // leaves every line showing its permanent label as before.
  const glassNumbers = rinkRes.data
    ? resolveRinkGlassNumbers(rinkRes.data, assets)
    : {}

  type CheckRow = { asset_id: string; status: string; note: string | null }
  const checks: AssetCheckLine[] = ((checksRes.data ?? []) as CheckRow[])
    .map((c) => {
      const asset = assetById.get(c.asset_id)
      return {
        label: asset ? formatAssetLabel(asset, glassNumbers) : "Unknown asset",
        asset_type: asset?.asset_type ?? "",
        status: c.status === "fail" ? ("fail" as const) : ("pass" as const),
        note: c.note,
        order: assetOrder.get(c.asset_id) ?? Number.MAX_SAFE_INTEGER,
      }
    })
    .sort((a, b) => a.order - b.order)
    .map(({ label, asset_type, status, note }) => ({
      label,
      asset_type,
      status,
      note,
    }))

  const categoryById = new Map(
    ((categoriesRes.data ?? []) as Array<{ id: string; label: string }>).map(
      (c) => [c.id, c.label],
    ),
  )

  type IssueRow = {
    asset_id: string | null
    category_id: string | null
    severity: string
    description: string
  }
  const issues: IssueLine[] = ((issuesRes.data ?? []) as IssueRow[]).map(
    (i) => ({
      asset_label: (() => {
        if (!i.asset_id) return null
        const asset = assetById.get(i.asset_id)
        return asset ? formatAssetLabel(asset, glassNumbers) : null
      })(),
      category: i.category_id ? categoryById.get(i.category_id) ?? null : null,
      severity:
        i.severity === "a" || i.severity === "b" || i.severity === "c"
          ? i.severity
          : "c",
      description: i.description,
    }),
  )

  type ItemRow = { id: string; label: string; sort_order: number }
  const items = (itemsRes.data ?? []) as ItemRow[]
  const itemById = new Map(items.map((i) => [i.id, i]))
  const itemOrder = new Map(items.map((i, idx) => [i.id, idx]))

  type ResponseRow = { item_id: string; status: string }
  const checklist: ChecklistLine[] = (
    (responsesRes.data ?? []) as ResponseRow[]
  )
    .map((r) => ({
      label: itemById.get(r.item_id)?.label ?? "Retired item",
      status: r.status === "flag" ? ("flag" as const) : ("pass" as const),
      order: itemOrder.get(r.item_id) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.order - b.order)
    .map(({ label, status }) => ({ label, status }))

  return {
    id: row.id,
    facility_id: row.facility_id,
    rink_name: rinkRes.data?.name ?? null,
    facility_name: facilityRes.data?.name ?? null,
    notes: row.notes,
    started_at: row.started_at,
    completed_at: row.completed_at,
    inspector,
    checks,
    issues,
    checklist,
  }
}

// -----------------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    padding: 32,
    paddingBottom: 44,
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
    marginBottom: 10,
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
  section: { marginBottom: 12 },
  sectionLabel: {
    fontSize: 10,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  body: { fontSize: 11, lineHeight: 1.45, color: "#0f172a" },
  tableHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
    paddingBottom: 3,
    marginBottom: 2,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e2e8f0",
    paddingVertical: 3,
  },
  thText: {
    fontSize: 8,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  cellText: { fontSize: 10, color: "#0f172a" },
  cellMuted: { fontSize: 10, color: "#64748b" },
  passText: { fontSize: 10, fontWeight: 700, color: "#16a34a" },
  failText: { fontSize: 10, fontWeight: 700, color: "#dc2626" },
  flagText: { fontSize: 10, fontWeight: 700, color: "#d97706" },
  colAsset: { width: "22%", paddingRight: 6 },
  colType: { width: "14%", paddingRight: 6 },
  colStatus: { width: "12%", paddingRight: 6 },
  colNote: { width: "52%" },
  issueColAsset: { width: "16%", paddingRight: 6 },
  issueColCategory: { width: "20%", paddingRight: 6 },
  issueColSeverity: { width: "24%", paddingRight: 6 },
  issueColDescription: { width: "40%" },
  checklistColItem: { width: "80%", paddingRight: 6 },
  checklistColStatus: { width: "20%" },
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

const SEVERITY_COLOR: Record<IssueSeverity, string> = {
  a: "#dc2626", // red — safety critical
  b: "#d97706", // amber — needs repair
  c: "#64748b", // slate — cosmetic
}

function fmtTs(iso: string | null): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function DasherBoardsPdf({
  r,
  meta,
}: {
  r: DasherBoardsRecord
  meta: PdfMetaHeaderData
}) {
  const inspectorName = r.inspector
    ? `${r.inspector.first_name} ${r.inspector.last_name}`
    : "—"
  const failCount = r.checks.filter((c) => c.status === "fail").length
  const passCount = r.checks.length - failCount
  const aCount = r.issues.filter((i) => i.severity === "a").length
  const hasProblems = failCount > 0 || r.issues.length > 0

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <PdfMetaHeader data={meta} />
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>Dasher Boards Walk</Text>
            <Text style={styles.subtitle}>
              {r.rink_name ?? "Rink"}
              {r.facility_name ? ` · ${r.facility_name}` : ""}
            </Text>
            <Text style={styles.meta}>
              Started {fmtTs(r.started_at)} · Completed {fmtTs(r.completed_at)}{" "}
              · Record {r.id}
            </Text>
          </View>
          <View style={styles.headerRight}>
            {aCount > 0 ? (
              <Text style={{ ...styles.chip, backgroundColor: SEVERITY_COLOR.a }}>
                {aCount} Safety
              </Text>
            ) : null}
            {failCount > 0 ? (
              <Text style={{ ...styles.chip, backgroundColor: SEVERITY_COLOR.b }}>
                {failCount} Fail
              </Text>
            ) : null}
            {!hasProblems ? <Text style={styles.okChip}>All Pass</Text> : null}
          </View>
        </View>

        <View style={styles.summaryGrid}>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Assets checked</Text>
            <Text style={styles.summaryValue}>{r.checks.length}</Text>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Passed</Text>
            <Text style={styles.summaryValue}>{passCount}</Text>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Failed</Text>
            <Text style={styles.summaryValue}>{failCount}</Text>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Issues reported</Text>
            <Text style={styles.summaryValue}>{r.issues.length}</Text>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Checklist items</Text>
            <Text style={styles.summaryValue}>{r.checklist.length}</Text>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Inspector</Text>
            <Text style={styles.summaryValue}>{inspectorName}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Perimeter summary</Text>
          {r.checks.length === 0 ? (
            <Text style={styles.cellMuted}>
              No assets were checked on this walk.
            </Text>
          ) : (
            <View>
              <View style={styles.tableHeaderRow}>
                <View style={styles.colAsset}>
                  <Text style={styles.thText}>Asset</Text>
                </View>
                <View style={styles.colType}>
                  <Text style={styles.thText}>Type</Text>
                </View>
                <View style={styles.colStatus}>
                  <Text style={styles.thText}>Status</Text>
                </View>
                <View style={styles.colNote}>
                  <Text style={styles.thText}>Note</Text>
                </View>
              </View>
              {r.checks.map((c, i) => (
                <View key={i} style={styles.tableRow} wrap={false}>
                  <View style={styles.colAsset}>
                    <Text style={styles.cellText}>{c.label}</Text>
                  </View>
                  <View style={styles.colType}>
                    <Text style={styles.cellMuted}>
                      {ASSET_TYPE_LABEL[c.asset_type] ?? c.asset_type ?? "—"}
                    </Text>
                  </View>
                  <View style={styles.colStatus}>
                    <Text
                      style={c.status === "fail" ? styles.failText : styles.passText}
                    >
                      {c.status === "fail" ? "Fail" : "Pass"}
                    </Text>
                  </View>
                  <View style={styles.colNote}>
                    <Text style={styles.cellText}>{c.note ?? "—"}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Issues reported this walk</Text>
          {r.issues.length === 0 ? (
            <Text style={styles.cellMuted}>
              No issues were reported on this walk.
            </Text>
          ) : (
            <View>
              <View style={styles.tableHeaderRow}>
                <View style={styles.issueColAsset}>
                  <Text style={styles.thText}>Asset</Text>
                </View>
                <View style={styles.issueColCategory}>
                  <Text style={styles.thText}>Category</Text>
                </View>
                <View style={styles.issueColSeverity}>
                  <Text style={styles.thText}>Severity</Text>
                </View>
                <View style={styles.issueColDescription}>
                  <Text style={styles.thText}>Description</Text>
                </View>
              </View>
              {r.issues.map((issue, i) => (
                <View key={i} style={styles.tableRow} wrap={false}>
                  <View style={styles.issueColAsset}>
                    <Text style={styles.cellText}>
                      {issue.asset_label ?? "—"}
                    </Text>
                  </View>
                  <View style={styles.issueColCategory}>
                    <Text style={styles.cellText}>{issue.category ?? "—"}</Text>
                  </View>
                  <View style={styles.issueColSeverity}>
                    <Text
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: SEVERITY_COLOR[issue.severity],
                      }}
                    >
                      {SEVERITY_LABEL[issue.severity]}
                    </Text>
                  </View>
                  <View style={styles.issueColDescription}>
                    <Text style={styles.cellText}>{issue.description}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {r.checklist.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Checklist</Text>
            <View>
              <View style={styles.tableHeaderRow}>
                <View style={styles.checklistColItem}>
                  <Text style={styles.thText}>Item</Text>
                </View>
                <View style={styles.checklistColStatus}>
                  <Text style={styles.thText}>Status</Text>
                </View>
              </View>
              {r.checklist.map((c, i) => (
                <View key={i} style={styles.tableRow} wrap={false}>
                  <View style={styles.checklistColItem}>
                    <Text style={styles.cellText}>{c.label}</Text>
                  </View>
                  <View style={styles.checklistColStatus}>
                    <Text
                      style={c.status === "flag" ? styles.flagText : styles.passText}
                    >
                      {c.status === "flag" ? "Flag" : "Pass"}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {r.notes ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Walk notes</Text>
            <Text style={styles.body}>{r.notes}</Text>
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          Generated by Rink Reports · dasher_boards ·{" "}
          {new Date().toLocaleString()}
        </Text>
      </Page>
    </Document>
  )
}

// -----------------------------------------------------------------------------
// Template entry
// -----------------------------------------------------------------------------

export async function renderDasherBoardsPdf(
  sb: SupabaseClient,
  recordId: string,
): Promise<ModulePdfResult | null> {
  const record = await fetchDasherBoardsRecord(sb, recordId)
  if (!record) return null
  const inspectorName = record.inspector
    ? `${record.inspector.first_name} ${record.inspector.last_name}`
    : "—"
  const meta = await resolveMetaHeader(
    record.facility_id,
    record.completed_at ?? record.started_at,
    inspectorName,
  )
  return {
    facility_id: record.facility_id,
    document: <DasherBoardsPdf r={record} meta={meta} />,
  }
}
