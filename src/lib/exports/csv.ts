import type { ExportSettingsRow } from "@/app/admin/exports/types"
import type { ExportTable } from "./types"

const DELIMITERS: Record<ExportSettingsRow["csv_delimiter"], string> = {
  comma: ",",
  tab: "\t",
  semicolon: ";",
}

// Characters that trigger formula evaluation in Excel / Google Sheets /
// LibreOffice when they lead a cell. User-authored export content (report
// notes, names, communication bodies) must never be evaluated as a formula on
// the admin's machine (CSV/DDE injection), so we neutralize them.
const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"])

// A plain signed number (incl. decimals / scientific notation). A leading
// `+`/`-` here is a legitimate value — e.g. a negative temperature like -5.0 —
// not a formula, so it must NOT be quote-prefixed (that would render it as text
// in Excel). Anything else leading with a trigger (=SUM, -1+1, @cmd) is escaped.
const PLAIN_NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/

/**
 * Escape a single CSV cell.
 *
 * 1. Formula-injection defense: if the value leads with a spreadsheet formula
 *    trigger (`= + - @`, tab, CR) and is not a plain number, prefix it with a
 *    single quote so the spreadsheet treats the whole cell as literal text.
 *    (Force-quoting alone is insufficient — Excel still evaluates `"=1+1"`.)
 * 2. RFC 4180 quoting: wrap in double quotes and double any embedded quotes
 *    when the value contains the delimiter, a quote, or a newline.
 */
function escapeCell(value: string, delimiter: string): string {
  let cell = value
  if (
    cell.length > 0 &&
    FORMULA_TRIGGERS.has(cell[0]) &&
    !PLAIN_NUMBER.test(cell)
  ) {
    cell = `'${cell}`
  }
  if (
    cell.includes(delimiter) ||
    cell.includes('"') ||
    cell.includes("\n") ||
    cell.includes("\r")
  ) {
    return `"${cell.replace(/"/g, '""')}"`
  }
  return cell
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
