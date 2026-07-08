import { Workbook } from "exceljs"

import type { ColumnDef } from "./types"

// Template generator: builds a downloadable .xlsx (header + example row + an
// Instructions sheet) and a .csv (header + example row) straight from a
// surface's column schema, so the template can never drift from validation.

function exampleCell(col: ColumnDef): string {
  if (col.example !== undefined) return col.example
  if (col.default !== undefined && col.default !== null) {
    return String(col.default)
  }
  if (col.type === "enum" && col.enumValues?.length) return col.enumValues[0]
  if (col.type === "boolean") return "false"
  if (col.type === "number") return "0"
  return ""
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function buildWorkbook(columns: ColumnDef[]): Workbook {
  const wb = new Workbook()

  const templateSheet = wb.addWorksheet("Template")
  templateSheet.addRow(columns.map((c) => c.header))
  templateSheet.addRow(columns.map((c) => exampleCell(c)))

  const instructionsSheet = wb.addWorksheet("Instructions")
  instructionsSheet.addRow([
    "Column",
    "Required?",
    "Type",
    "Allowed values",
    "Default",
    "Notes",
  ])
  for (const c of columns) {
    instructionsSheet.addRow([
      c.header,
      c.required ? "Yes" : "No",
      c.type,
      c.type === "enum" && c.enumValues ? c.enumValues.join(", ") : "",
      c.default !== undefined && c.default !== null ? String(c.default) : "",
      c.description ?? "",
    ])
  }

  return wb
}

export async function downloadTemplateXlsx(
  columns: ColumnDef[],
  surfaceId: string,
) {
  const wb = buildWorkbook(columns)
  const out = await wb.xlsx.writeBuffer()
  triggerDownload(
    new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${surfaceId}-template.xlsx`,
  )
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function downloadTemplateCsv(columns: ColumnDef[], surfaceId: string) {
  const header = columns.map((c) => csvCell(c.header)).join(",")
  const example = columns.map((c) => csvCell(exampleCell(c))).join(",")
  const csv = `${header}\r\n${example}\r\n`
  triggerDownload(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
    `${surfaceId}-template.csv`,
  )
}
