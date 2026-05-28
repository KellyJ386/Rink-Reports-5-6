import type { ExportSettingsRow } from "@/app/admin/exports/types"
import type { ExportTable } from "./types"

const DELIMITERS: Record<ExportSettingsRow["csv_delimiter"], string> = {
  comma: ",",
  tab: "\t",
  semicolon: ";",
}

/**
 * Escape a single CSV cell per RFC 4180: wrap in double quotes and double any
 * embedded quotes when the value contains the delimiter, a quote, or a newline.
 */
function escapeCell(value: string, delimiter: string): string {
  if (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * Serialize an ExportTable to CSV bytes honoring the facility's configured
 * delimiter. Rows are CRLF-terminated and a UTF-8 BOM is prepended so Excel
 * opens content with non-ASCII characters (°, accented names) correctly.
 */
export function buildCsv(
  table: ExportTable,
  delimiter: ExportSettingsRow["csv_delimiter"],
): Buffer {
  const sep = DELIMITERS[delimiter] ?? ","
  const lines: string[] = []
  lines.push(table.headers.map((h) => escapeCell(h, sep)).join(sep))
  for (const row of table.rows) {
    lines.push(row.map((c) => escapeCell(c ?? "", sep)).join(sep))
  }
  const text = "﻿" + lines.join("\r\n") + "\r\n"
  return Buffer.from(text, "utf-8")
}
