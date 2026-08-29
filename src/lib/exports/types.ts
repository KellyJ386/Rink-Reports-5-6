import type { ExportSettingsRow } from "@/app/admin/exports/types"

/** A fully-resolved table ready to serialize to CSV or render to PDF. */
export type ExportTable = {
  /** Module name (e.g. "daily_reports"). */
  module: string
  /** Human title for PDF header / filename. */
  title: string
  /** Ordered column headers (already filtered by visibility selection). */
  headers: string[]
  /** Ordered rows; each cell already stringified for display. */
  rows: string[][]
}

export type ExportFormat = "csv" | "pdf"

/** Settings subset the builders read; the full row is accepted. */
export type ExportSettings = ExportSettingsRow

/** Bytes + metadata for a generated export file. */
export type ExportFile = {
  bytes: Buffer
  filename: string
  contentType: string
}

/**
 * Fallback settings for a facility with no export_settings row. Migration
 * 269 seeds one for every facility (existing, via backfill; new, via the
 * facilities-insert trigger), so this should no longer be the common path —
 * it now exists purely so a caller can never crash on a row that is somehow
 * still missing. Shared by the raw-table CSV/PDF export pipeline
 * (build-export.ts) and the Insights PDF export.
 */
export function defaultExportSettings(facilityId: string): ExportSettingsRow {
  return {
    id: "",
    facility_id: facilityId,
    logo_url: null,
    header_text: null,
    footer_text: null,
    paper_size: "letter",
    date_format: "MM/DD/YYYY",
    csv_delimiter: "comma",
    include_facility_name: true,
    include_date: true,
    include_submitted_by: true,
    module_column_visibility: {},
    created_at: "",
    updated_at: null,
  }
}
