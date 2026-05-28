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
