// Pure refrigeration-submission helpers: payload parsing, computed-field
// evaluation, and the critical-note guard. NO server-only imports live here, so
// this module is safe to unit-test in isolation (see compute.test.ts) and is
// re-used by the server-only `submit.ts` (which adds DB + notification I/O).

import type {
  RefrigerationFieldType,
  SubmittedFieldValue,
  ThresholdSeverity,
} from "../types"

export const VALID_FIELD_TYPES = new Set<RefrigerationFieldType>([
  "numeric",
  "text",
  "boolean",
  "select",
  "computed",
])

export const VALID_SEVERITIES = new Set<ThresholdSeverity>([
  "warn",
  "high",
  "critical",
])

export const SEVERITY_RANK: Record<ThresholdSeverity, number> = {
  warn: 1,
  high: 2,
  critical: 3,
}

// ---------------------------------------------------------------------------
// Input model + parsing
// ---------------------------------------------------------------------------

/** A corrective-action note tied to a specific reading by field + equipment. */
export type FollowupInput = {
  field_id: string
  equipment_id: string | null
  body: string
}

export type RefrigerationInput = {
  notes?: string
  /** ISO string of when the round was taken; null ⇒ server defaults to now(). */
  reading_at: string | null
  shift: string | null
  round_no: number | null
  values: SubmittedFieldValue[]
  followups: FollowupInput[]
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

function parseReadingAt(v: unknown): string | null {
  if (typeof v !== "string" || v.trim() === "") return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function parseRoundNo(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v)) return v
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v)
    if (Number.isInteger(n)) return n
  }
  return null
}

function parseValues(raw: unknown): SubmittedFieldValue[] {
  if (!Array.isArray(raw)) return []
  const values: SubmittedFieldValue[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    const field_id = typeof r.field_id === "string" ? r.field_id : null
    if (!field_id) continue
    const equipment_id =
      typeof r.equipment_id === "string" ? r.equipment_id : null
    const ftRaw =
      typeof r.field_type_snapshot === "string" ? r.field_type_snapshot : ""
    // Computed values are derived server-side; never trust a client-supplied one.
    if (
      !VALID_FIELD_TYPES.has(ftRaw as RefrigerationFieldType) ||
      ftRaw === "computed"
    ) {
      continue
    }
    const field_type_snapshot = ftRaw as RefrigerationFieldType
    values.push({
      field_id,
      equipment_id,
      label_snapshot:
        typeof r.label_snapshot === "string" ? r.label_snapshot : "",
      equipment_name_snapshot:
        typeof r.equipment_name_snapshot === "string"
          ? r.equipment_name_snapshot
          : "",
      field_type_snapshot,
      unit_snapshot: typeof r.unit_snapshot === "string" ? r.unit_snapshot : null,
      value_text:
        typeof r.value_text === "string" && r.value_text.length > 0
          ? r.value_text
          : null,
      value_numeric:
        typeof r.value_numeric === "number" && Number.isFinite(r.value_numeric)
          ? r.value_numeric
          : null,
      value_boolean:
        typeof r.value_boolean === "boolean" ? r.value_boolean : null,
    })
  }
  return values
}

function parseFollowups(raw: unknown): FollowupInput[] {
  if (!Array.isArray(raw)) return []
  const out: FollowupInput[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    const field_id = typeof r.field_id === "string" ? r.field_id : null
    const body = str(r.body)
    if (!field_id || !body) continue
    out.push({
      field_id,
      equipment_id: typeof r.equipment_id === "string" ? r.equipment_id : null,
      body,
    })
  }
  return out
}

/** Build a normalized input from a parsed JSON object (online or offline). */
export function buildInputFromObject(obj: unknown): RefrigerationInput | null {
  if (!obj || typeof obj !== "object") return null
  const o = obj as Record<string, unknown>
  return {
    notes: typeof o.notes === "string" ? o.notes : undefined,
    reading_at: parseReadingAt(o.reading_at),
    shift: str(o.shift) || null,
    round_no: parseRoundNo(o.round_no),
    values: parseValues(o.values),
    followups: parseFollowups(o.followups),
  }
}

/** Online path: the form serializes the input object into `values_json`. */
export function buildInputFromForm(formData: FormData): RefrigerationInput | null {
  const raw = String(formData.get("values_json") ?? "")
  try {
    return buildInputFromObject(JSON.parse(raw))
  } catch {
    return null
  }
}

/** Offline path: the queued payload IS the input object (untrusted JSON). */
export function buildInputFromPayload(raw: unknown): RefrigerationInput | null {
  return buildInputFromObject(raw)
}

// ---------------------------------------------------------------------------
// Computed fields (item 6) — minimal, whitelisted arithmetic
// ---------------------------------------------------------------------------

export type ComputedSpec = {
  operator: "+" | "-" | "*" | "/"
  a: string
  b: string
}

const FORMULA_RE = /^\s*a\s*([+\-*/])\s*b\s*$/

/** Parse the documented computed `options` schema; null if malformed. */
export function parseComputedSpec(options: unknown): ComputedSpec | null {
  if (!options || typeof options !== "object") return null
  const o = options as Record<string, unknown>
  const formula = typeof o.formula === "string" ? o.formula : ""
  const m = FORMULA_RE.exec(formula)
  if (!m) return null
  const operator = m[1] as ComputedSpec["operator"]
  const operands = o.operands
  if (!operands || typeof operands !== "object") return null
  const a = str((operands as Record<string, unknown>).a)
  const b = str((operands as Record<string, unknown>).b)
  if (!a || !b) return null
  return { operator, a, b }
}

/** Evaluate a parsed spec against an operand-key → value lookup. */
export function evaluateComputed(
  spec: ComputedSpec,
  lookup: (key: string) => number | null,
): number | null {
  const a = lookup(spec.a)
  const b = lookup(spec.b)
  if (a === null || b === null) return null
  switch (spec.operator) {
    case "+":
      return a + b
    case "-":
      return a - b
    case "*":
      return a * b
    case "/":
      return b === 0 ? null : a / b
  }
}

export type FieldConfigRow = {
  id: string
  section_id: string
  equipment_id: string | null
  key: string
  label: string
  unit: string | null
  field_type: string
  options: unknown
}

export type RowToInsert = {
  facility_id: string
  report_id: string
  field_id: string | null
  equipment_id: string | null
  label_snapshot: string
  equipment_name_snapshot: string | null
  field_type_snapshot: string
  unit_snapshot: string | null
  value_text: string | null
  value_numeric: number | null
  value_boolean: boolean | null
  threshold_id: string | null
  is_out_of_range: boolean
  // Carried only for in-memory matching; stripped before insert.
  _severity?: ThresholdSeverity | null
}

/**
 * Derive computed-field results from the submitted numeric values. Operands are
 * resolved by field `key` within the SAME section as the computed field (last
 * value wins when a section has multiple equipment). Pure given its inputs, so
 * it is unit-testable without a DB.
 */
export function buildComputedRows(
  computedFields: FieldConfigRow[],
  numericValues: Array<{ field_id: string; value_numeric: number }>,
  fieldById: Map<string, FieldConfigRow>,
): Array<{ field: FieldConfigRow; value: number }> {
  const bySectionKey = new Map<string, Map<string, number>>()
  for (const v of numericValues) {
    const cfg = fieldById.get(v.field_id)
    if (!cfg) continue
    let m = bySectionKey.get(cfg.section_id)
    if (!m) {
      m = new Map()
      bySectionKey.set(cfg.section_id, m)
    }
    m.set(cfg.key, v.value_numeric)
  }

  const out: Array<{ field: FieldConfigRow; value: number }> = []
  for (const field of computedFields) {
    const spec = parseComputedSpec(field.options)
    if (!spec) continue
    const sectionMap = bySectionKey.get(field.section_id)
    if (!sectionMap) continue
    const result = evaluateComputed(spec, (k) =>
      sectionMap.has(k) ? (sectionMap.get(k) as number) : null,
    )
    if (result === null || !Number.isFinite(result)) continue
    out.push({ field, value: result })
  }
  return out
}

// ---------------------------------------------------------------------------
// Validation: critical out-of-range readings require a corrective-action note
// ---------------------------------------------------------------------------

export function followupKey(fieldId: string, equipmentId: string | null): string {
  return `${fieldId}::${equipmentId ?? "null"}`
}

/**
 * For every value flagged out-of-range against a CRITICAL threshold, require a
 * matching follow-up note (by field_id + equipment_id). Returns an error message
 * if any are missing, else null. Runs BEFORE any insert so a failed submit
 * writes nothing.
 */
export function validateCriticalFollowups(
  rows: RowToInsert[],
  followups: FollowupInput[],
): string | null {
  const have = new Set(
    followups.map((f) => followupKey(f.field_id, f.equipment_id)),
  )
  const missing: string[] = []
  for (const row of rows) {
    if (
      row.is_out_of_range &&
      row._severity === "critical" &&
      row.field_id &&
      !have.has(followupKey(row.field_id, row.equipment_id))
    ) {
      missing.push(row.label_snapshot || "reading")
    }
  }
  if (missing.length === 0) return null
  const list = missing.slice(0, 3).join(", ")
  const more = missing.length > 3 ? ` and ${missing.length - 3} more` : ""
  return `A corrective-action note is required for critical out-of-range readings: ${list}${more}.`
}

export function isEmptyRow(row: SubmittedFieldValue): boolean {
  return (
    row.value_text === null &&
    row.value_numeric === null &&
    row.value_boolean === null
  )
}

export type ThresholdRow = {
  id: string
  field_id: string
  equipment_id: string | null
  min_value: number | null
  max_value: number | null
  severity: string
}

export type OorDetail = {
  label: string
  equipment: string
  value: number
  unit: string | null
  min: number | null
  max: number | null
  severity: ThresholdSeverity
}
