import { Workbook } from "exceljs"

import {
  normalizeCellValue,
  parseCsvText,
  toParsedSheet,
  type ParsedSheet,
} from "./parse-core"

// Parsing entry point for the bulk importer. `.xlsx` goes through exceljs;
// `.csv` goes through the small RFC 4180 parser in parse-core.ts (exceljs's
// CSV reader is Node-stream based and unusable in the browser). Every cell is
// normalized to a plain string (see normalizeCellValue) so CSV and
// spreadsheet inputs behave identically; type coercion happens later in
// validate.ts per ColumnDef. Legacy `.xls` (BIFF) is NOT supported — exceljs
// only reads OOXML — and the panel rejects it before calling parseFile.

export type { ParsedSheet } from "./parse-core"

function isCsv(file: File): boolean {
  return /\.csv$/i.test(file.name) || file.type === "text/csv"
}

export async function parseFile(file: File): Promise<ParsedSheet> {
  if (isCsv(file)) {
    const text = await file.text()
    return toParsedSheet(parseCsvText(text))
  }

  const buf = await file.arrayBuffer()
  const wb = new Workbook()
  await wb.xlsx.load(buf)
  const ws = wb.worksheets[0]
  if (!ws) return { headers: [], rows: [] }

  const width = ws.columnCount
  const grid: string[][] = []
  ws.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = []
    for (let c = 1; c <= width; c++) {
      cells.push(normalizeCellValue(row.getCell(c).value))
    }
    grid.push(cells)
  })

  return toParsedSheet(grid)
}
