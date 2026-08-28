// Pure segment-history CSV builder: shapes pre-fetched RLS-scoped rows into an
// exportable ORFA liability artifact (per-panel inspection record with date, who,
// what found). This module is pure and dependency-free, safe to unit-test in
// isolation (see segment-history-csv.test.ts) without server-only imports or DB.

// ---------------------------------------------------------------------------
// Row model
// ---------------------------------------------------------------------------

export type SegmentHistoryRow = {
  occurredAt: string // ISO timestamp
  rinkName: string
  segmentDisplayLabel: string // resolved display label TODAY
  segmentIdentityLabel: string // permanent B12/G12/D3
  loggedAsLabel: string | null // label_snapshot at log time (null = same/unknown)
  zoneName: string | null
  recordType: "walk_check" | "issue"
  inspectionKind: "routine" | "annual_contractor" | null // null for standalone issues
  contractorName: string | null
  outcome: string // "pass"/"fail" for checks; "a"/"b"/"c" severity for issues
  category: string | null
  detail: string | null // check note or issue description
  recordedBy: string | null // person name
  resolvedAt: string | null // issues only
}

// ---------------------------------------------------------------------------
// CSV header and constants
// ---------------------------------------------------------------------------

export const SEGMENT_HISTORY_CSV_HEADER = [
  "Date",
  "Rink",
  "Segment",
  "Identity label",
  "Logged as",
  "Zone",
  "Record type",
  "Inspection kind",
  "Contractor",
  "Outcome",
  "Category",
  "Detail",
  "Recorded by",
  "Resolved",
] as const

// ---------------------------------------------------------------------------
// RFC 4180 CSV escaping
// ---------------------------------------------------------------------------

/**
 * Escape a single field value per RFC 4180. Wraps in double quotes and doubles
 * any embedded quotes if the value contains a comma, double quote, CR, or LF;
 * otherwise returns the value as-is.
 */
export function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\r") || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ---------------------------------------------------------------------------
// CSV generation
// ---------------------------------------------------------------------------

/**
 * Build the complete CSV document from pre-sorted rows. Header line + one line
 * per row, fields in header order, nulls as empty strings. Record types and
 * inspection kinds are label-mapped. Lines are joined with \r\n (RFC 4180) and
 * the output ends with a final \r\n.
 */
export function buildSegmentHistoryCsv(rows: readonly SegmentHistoryRow[]): string {
  const headerLine = SEGMENT_HISTORY_CSV_HEADER.join(",");

  const dataLines = rows.map((row) => {
    const values: string[] = [
      csvEscape(row.occurredAt),
      csvEscape(row.rinkName),
      csvEscape(row.segmentDisplayLabel),
      csvEscape(row.segmentIdentityLabel),
      row.loggedAsLabel ? csvEscape(row.loggedAsLabel) : "",
      row.zoneName ? csvEscape(row.zoneName) : "",
      mapRecordType(row.recordType),
      mapInspectionKind(row.inspectionKind),
      row.contractorName ? csvEscape(row.contractorName) : "",
      csvEscape(row.outcome),
      row.category ? csvEscape(row.category) : "",
      row.detail ? csvEscape(row.detail) : "",
      row.recordedBy ? csvEscape(row.recordedBy) : "",
      row.resolvedAt ? csvEscape(row.resolvedAt) : "",
    ];
    return values.join(",");
  });

  const lines = [headerLine, ...dataLines];
  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Label mapping
// ---------------------------------------------------------------------------

function mapRecordType(recordType: "walk_check" | "issue"): string {
  switch (recordType) {
    case "walk_check":
      return "Walk check";
    case "issue":
      return "Issue";
  }
}

function mapInspectionKind(inspectionKind: "routine" | "annual_contractor" | null): string {
  if (inspectionKind === null) return "";
  switch (inspectionKind) {
    case "routine":
      return "Routine";
    case "annual_contractor":
      return "Annual contractor";
  }
}

// ---------------------------------------------------------------------------
// Filename generation
// ---------------------------------------------------------------------------

/**
 * Generate a descriptive filename for the segment history export.
 */
export function segmentHistoryFilename(rinkSlug: string, dateKey: string): string {
  return `dasher-inspection-history-${rinkSlug}-${dateKey}.csv`;
}
