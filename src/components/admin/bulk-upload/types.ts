import type { ZodTypeAny } from "zod"

// Shared contract for the schema-driven CSV/XLSX bulk importer.
// One `<BulkUploadPanel schema={...} />` serves every checklist builder; each
// surface supplies an ImportSchema describing its columns, row validation, and
// the server action that performs the facility-scoped insert.

export type ColumnType = "string" | "number" | "boolean" | "enum"

export type ColumnDef = {
  /** Row field / DB column the cell maps to. */
  key: string
  /** Template header; matched case-insensitive + trimmed against the file. */
  header: string
  required: boolean
  type: ColumnType
  /** Allowed values when type === "enum". */
  enumValues?: string[]
  /** Applied when the cell is blank or the column is omitted from the file. */
  default?: unknown
  /** Value used for this column in the generated template's example row. */
  example?: string
  /** Short human description shown on the template's Instructions sheet. */
  description?: string
}

/** A row that passed client-side validation; `values` is the parsed output. */
export type ValidatedRow = {
  /** 1-based source row number (data rows; header excluded). */
  rowNumber: number
  values: Record<string, unknown>
}

export type ImportResult =
  | { ok: true; inserted: number; message?: string }
  | { ok: false; error: string }

export type ImportSchema = {
  surfaceId: string
  columns: ColumnDef[]
  /** Full-row validation incl. cross-field rules. */
  zodRow: ZodTypeAny
  /** Server action; derives facility_id server-side and inserts valid rows. */
  onImport: (rows: ValidatedRow[]) => Promise<ImportResult>
  /** strict = block on any row error (default); partial = import valid rows. */
  mode?: "strict" | "partial"
}

/** Per-surface spec without the bound server action (client-safe module). */
export type ImportSpec = Omit<ImportSchema, "onImport">
