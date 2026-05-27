import * as XLSX from "xlsx"

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

function buildWorkbook(columns: ColumnDef[]): XLSX.WorkBook {
  const headerRow = columns.map((c) => c.header)
  const exampleRow = columns.map((c) => exampleCell(c))
  const templateSheet = XLSX.utils.aoa_to_sheet([headerRow, exampleRow])

  const instructionsHeader = [
    "Column",
    "Required?",
    "Type",
    "Allowed values",
    "Default",
    "Notes",
  ]
  const instructionsRows = columns.map((c) => [
    c.header,
    c.required ? "Yes" : "No",
    c.type,
    c.type === "enum" && c.enumValues ? c.enumValues.join(", ") : "",
    c.default !== undefined && c.default !== null ? String(c.default) : "",
    c.description ?? "",
  ])
  const instructionsSheet = XLSX.utils.aoa_to_sheet([
    instructionsHeader,
    ...instructionsRows,
  ])

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, templateSheet, "Template")
  XLSX.utils.book_append_sheet(wb, instructionsSheet, "Instructions")
  return wb
}

export function downloadTemplateXlsx(columns: ColumnDef[], surfaceId: string) {
  const wb = buildWorkbook(columns)
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer
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
