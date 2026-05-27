import * as XLSX from "xlsx"

// Single parsing stack for both CSV and XLSX/XLS via SheetJS. Everything is
// read as formatted strings (raw: false) so CSV and spreadsheet inputs behave
// identically; type coercion happens later in validate.ts per ColumnDef.

export type ParsedSheet = {
  headers: string[]
  rows: string[][]
}

export async function parseFile(file: File): Promise<ParsedSheet> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: "array", raw: false })
  const firstSheetName = wb.SheetNames[0]
  if (!firstSheetName) return { headers: [], rows: [] }
  const ws = wb.Sheets[firstSheetName]

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  })

  if (aoa.length === 0) return { headers: [], rows: [] }

  const headers = (aoa[0] ?? []).map((h) => String(h ?? "").trim())
  const rows = aoa
    .slice(1)
    .map((r) => headers.map((_, i) => String((r as unknown[])[i] ?? "")))
    // Drop rows where every cell is blank.
    .filter((r) => r.some((c) => c.trim().length > 0))

  return { headers, rows }
}
