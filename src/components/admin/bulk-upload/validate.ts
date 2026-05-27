import type { ZodTypeAny } from "zod"

import type { ColumnDef } from "./types"
import type { ParsedSheet } from "./parse"

export type HeaderMapping = {
  /** column.key -> index into a parsed row, or undefined when the column is absent. */
  byKey: Record<string, number | undefined>
  /** Headers present in the file but not described by the schema. */
  unknownHeaders: string[]
  /** Required columns whose header was not found in the file. */
  missingRequired: string[]
}

const norm = (s: string) => s.trim().toLowerCase()

export function mapHeaders(
  headers: string[],
  columns: ColumnDef[],
): HeaderMapping {
  const headerIndex = new Map<string, number>()
  headers.forEach((h, i) => {
    const key = norm(h)
    if (key && !headerIndex.has(key)) headerIndex.set(key, i)
  })

  const byKey: Record<string, number | undefined> = {}
  const knownHeaderKeys = new Set<string>()
  const missingRequired: string[] = []

  for (const col of columns) {
    const idx = headerIndex.get(norm(col.header))
    byKey[col.key] = idx
    knownHeaderKeys.add(norm(col.header))
    if (idx === undefined && col.required) missingRequired.push(col.header)
  }

  const unknownHeaders = headers.filter(
    (h) => h.trim().length > 0 && !knownHeaderKeys.has(norm(h)),
  )

  return { byKey, unknownHeaders, missingRequired }
}

const TRUE_VALUES = new Set(["true", "1", "yes", "y", "t"])
const FALSE_VALUES = new Set(["false", "0", "no", "n", "f"])

/**
 * Coerce a raw cell string into the JS type declared by the ColumnDef.
 * Blank cells (or omitted columns) fall back to the column default. On a type
 * mismatch we return the original string so the row's zod schema reports a
 * precise, user-facing error rather than silently dropping the value.
 */
export function coerceCell(raw: string, col: ColumnDef): unknown {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return col.default !== undefined ? col.default : undefined
  }

  switch (col.type) {
    case "number": {
      const n = Number(trimmed)
      return Number.isNaN(n) ? trimmed : n
    }
    case "boolean": {
      const lower = trimmed.toLowerCase()
      if (TRUE_VALUES.has(lower)) return true
      if (FALSE_VALUES.has(lower)) return false
      return trimmed
    }
    case "enum":
    case "string":
    default:
      return trimmed
  }
}

export type RowResult = {
  rowNumber: number
  /** Parsed (zod output) values on success; coerced inputs on failure. */
  values: Record<string, unknown>
  ok: boolean
  errors: string[]
}

export function validateRows(
  parsed: ParsedSheet,
  columns: ColumnDef[],
  zodRow: ZodTypeAny,
  mapping: HeaderMapping,
): RowResult[] {
  return parsed.rows.map((row, i) => {
    const input: Record<string, unknown> = {}
    for (const col of columns) {
      const idx = mapping.byKey[col.key]
      const raw = idx === undefined ? "" : (row[idx] ?? "")
      input[col.key] = coerceCell(raw, col)
    }

    const result = zodRow.safeParse(input)
    if (result.success) {
      return {
        rowNumber: i + 1,
        values: result.data as Record<string, unknown>,
        ok: true,
        errors: [],
      }
    }

    const errors = result.error.issues.map((issue) => {
      const path = issue.path.join(".")
      return path ? `${path}: ${issue.message}` : issue.message
    })
    return { rowNumber: i + 1, values: input, ok: false, errors }
  })
}
