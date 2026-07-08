// Pure, dependency-free parsing helpers for the bulk-upload importer.
// Kept free of exceljs / browser APIs so they can be unit-tested in plain
// Node (see parse-core.test.ts and the vitest notes in CLAUDE.md). The
// exceljs-backed entry point lives in parse.ts.

export type ParsedSheet = {
  headers: string[]
  rows: string[][]
}

/**
 * Minimal RFC 4180 CSV parser: quoted fields, escaped quotes (""), commas and
 * newlines inside quotes, and CRLF / LF / CR row terminators. Values are kept
 * exactly as written — type coercion happens later in validate.ts.
 */
export function parseCsvText(text: string): string[][] {
  // Strip a UTF-8 BOM if the decoder left one behind.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  let i = 0

  const endField = () => {
    row.push(field)
    field = ""
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"' && field.length === 0) {
      inQuotes = true
      i++
      continue
    }
    if (ch === ",") {
      endField()
      i++
      continue
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") i++
      endRow()
      i++
      continue
    }
    if (ch === "\n") {
      endRow()
      i++
      continue
    }
    field += ch
    i++
  }
  if (field.length > 0 || row.length > 0) endRow()

  return rows
}

/**
 * Excel stores at most 15 significant decimal digits, so a plain
 * `String(number)` can leak binary float noise ("0.30000000000000004") that a
 * spreadsheet UI would never show. Round-trip through 15 significant digits
 * to match what the user saw in their spreadsheet.
 */
function numberToString(n: number): string {
  if (!Number.isFinite(n)) return ""
  return String(Number(n.toPrecision(15)))
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

/**
 * exceljs parses Excel date cells into UTC-based JS Dates. Render them as an
 * unambiguous "YYYY-MM-DD" (plus " HH:MM" / ":SS" only when there is a time
 * component) using the UTC getters so the viewer's timezone never shifts the
 * calendar date.
 */
function dateToString(d: Date): string {
  if (Number.isNaN(d.getTime())) return ""
  const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
  const h = d.getUTCHours()
  const m = d.getUTCMinutes()
  const s = d.getUTCSeconds()
  if (h === 0 && m === 0 && s === 0) return date
  const time = `${pad2(h)}:${pad2(m)}${s !== 0 ? `:${pad2(s)}` : ""}`
  return `${date} ${time}`
}

/**
 * Normalize an exceljs `cell.value` to the plain string form the old SheetJS
 * `raw: false` path produced, so downstream header mapping and per-ColumnDef
 * coercion (validate.ts) behave identically. Handles the exceljs object
 * shapes structurally (rich text, hyperlink, formula/shared-formula results,
 * error cells) without importing exceljs.
 */
export function normalizeCellValue(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number") return numberToString(value)
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
  if (value instanceof Date) return dateToString(value)
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>
    if (typeof obj.error === "string") return obj.error
    if (Array.isArray(obj.richText)) {
      return obj.richText
        .map((run) => String((run as { text?: unknown }).text ?? ""))
        .join("")
    }
    // Hyperlink cells: show the display text, not the URL.
    if (typeof obj.text === "string") return obj.text
    // Formula / shared-formula cells: show the cached result.
    if ("result" in obj) return normalizeCellValue(obj.result)
    if ("formula" in obj || "sharedFormula" in obj) return ""
  }
  return String(value)
}

/**
 * Turn a rows-of-strings grid into the ParsedSheet contract: row 0 becomes
 * the trimmed header row; every data row is padded/truncated to the header
 * width with "" for missing cells; rows whose cells are all blank are
 * dropped (matching SheetJS `blankrows: false` + the old whitespace filter).
 */
export function toParsedSheet(grid: string[][]): ParsedSheet {
  if (grid.length === 0) return { headers: [], rows: [] }

  const headers = (grid[0] ?? []).map((h) => String(h ?? "").trim())
  const rows = grid
    .slice(1)
    .map((r) => headers.map((_, i) => String(r[i] ?? "")))
    // Drop rows where every cell is blank.
    .filter((r) => r.some((c) => c.trim().length > 0))

  return { headers, rows }
}
