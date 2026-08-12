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

/**
 * Validate a submitted round number against the facility's configured
 * readings-per-shift cap (refrigeration_settings.readings_per_shift).
 * Returns an error message, or null when acceptable.
 *   cap == null      ⇒ unlimited (no upper bound)
 *   roundNo == null  ⇒ acceptable (round number is optional)
 */
export function validateRoundNo(
  roundNo: number | null,
  cap: number | null,
): string | null {
  if (roundNo == null) return null
  if (!Number.isInteger(roundNo) || roundNo < 1) {
    return "Round number must be a positive whole number."
  }
  if (cap != null && roundNo > cap) {
    return `Round number cannot exceed the configured ${cap} reading(s) per shift.`
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
 * Config foot-gun detector shared by submit + recompute: returns a skip reason
 * when a computed field's spec is malformed, points at a key with no active
 * field in its section, or chains onto another computed field (unsupported in
 * v1). Returns null when the spec is structurally sound.
 */
export function computedConfigProblem(
  field: FieldConfigRow,
  spec: ComputedSpec | null,
  sectionConfigByKey: Map<string, FieldConfigRow> | undefined,
): string | null {
  if (!spec) return "invalid computed options (expected formula + operands)"
  for (const key of [spec.a, spec.b]) {
    const operand = sectionConfigByKey?.get(key)
    if (!operand) {
      return `operand "${key}" does not match an active field in this section`
    }
    if (operand.field_type === "computed") {
      return `operand "${key}" is itself a computed field (chaining is unsupported)`
    }
  }
  return null
}

/** Group active field configs by section, keyed by field key (last wins). */
function configBySection(
  fieldById: Map<string, FieldConfigRow>,
): Map<string, Map<string, FieldConfigRow>> {
  const out = new Map<string, Map<string, FieldConfigRow>>()
  for (const cfg of fieldById.values()) {
    let m = out.get(cfg.section_id)
    if (!m) {
      m = new Map()
      out.set(cfg.section_id, m)
    }
    m.set(cfg.key, cfg)
  }
  return out
}

/**
 * Derive computed-field results from the submitted numeric values. Operands are
 * resolved by field `key` within the SAME section as the computed field (last
 * value wins when a section has multiple equipment). Pure given its inputs, so
 * it is unit-testable without a DB.
 *
 * `onSkip` (optional) is invoked for CONFIG problems only — malformed options,
 * an operand key with no active field, or chaining onto another computed field.
 * A structurally valid field whose operand VALUES simply weren't submitted is
 * skipped silently (a blank reading is normal, not a misconfiguration).
 */
export function buildComputedRows(
  computedFields: FieldConfigRow[],
  numericValues: Array<{ field_id: string; value_numeric: number }>,
  fieldById: Map<string, FieldConfigRow>,
  onSkip?: (field: FieldConfigRow, reason: string) => void,
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
  const cfgBySection = configBySection(fieldById)

  const out: Array<{ field: FieldConfigRow; value: number }> = []
  for (const field of computedFields) {
    const spec = parseComputedSpec(field.options)
    const problem = computedConfigProblem(
      field,
      spec,
      cfgBySection.get(field.section_id),
    )
    if (problem || !spec) {
      onSkip?.(field, problem ?? "invalid computed options")
      continue
    }
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
// Threshold matching (pure) — shared by submit and recompute-on-edit
// ---------------------------------------------------------------------------

/** Equipment-specific threshold wins over the section-level (null) one. */
export function lookupThresholdRow(
  thresholds: ThresholdRow[],
  fieldId: string,
  equipmentId: string | null,
): ThresholdRow | null {
  if (equipmentId) {
    const eqMatch = thresholds.find(
      (t) => t.field_id === fieldId && t.equipment_id === equipmentId,
    )
    if (eqMatch) return eqMatch
  }
  return (
    thresholds.find((t) => t.field_id === fieldId && t.equipment_id === null) ??
    null
  )
}

export function thresholdFlag(
  t: ThresholdRow | null,
  value: number,
): {
  thresholdId: string | null
  isOor: boolean
  severity: ThresholdSeverity | null
} {
  if (!t) return { thresholdId: null, isOor: false, severity: null }
  const minOut = t.min_value !== null && value < t.min_value
  const maxOut = t.max_value !== null && value > t.max_value
  const severity: ThresholdSeverity = VALID_SEVERITIES.has(
    t.severity as ThresholdSeverity,
  )
    ? (t.severity as ThresholdSeverity)
    : "warn"
  return { thresholdId: t.id, isOor: minOut || maxOut, severity }
}

// ---------------------------------------------------------------------------
// Recompute-on-edit (pure planning; the admin action applies the plan)
// ---------------------------------------------------------------------------

/** The slice of a stored refrigeration_report_values row the planner needs. */
export type StoredValueRow = {
  id: string
  field_id: string | null
  equipment_id: string | null
  label_snapshot: string
  field_type_snapshot: string
  unit_snapshot: string | null
  value_numeric: number | null
  is_out_of_range: boolean
  threshold_id: string | null
}

export type ValueEditPlan = {
  /** The corrected source reading with its re-checked threshold flags. */
  edited: {
    id: string
    value_numeric: number
    is_out_of_range: boolean
    threshold_id: string | null
    before: { value_numeric: number | null; is_out_of_range: boolean }
  }
  /** Dependent computed values to update (or insert when `id` is null). */
  recomputed: Array<{
    id: string | null
    field: FieldConfigRow
    value_numeric: number
    is_out_of_range: boolean
    threshold_id: string | null
    before: { value_numeric: number | null; is_out_of_range: boolean } | null
  }>
  /** Computed fields left untouched because of a config problem. */
  skipped: Array<{ field: FieldConfigRow; reason: string }>
}

/**
 * Plan an admin correction to a single NUMERIC reading: re-check the edited
 * value's threshold, then recompute every active computed field in the same
 * section whose formula depends on the edited field's key. Mirrors
 * buildComputedRows semantics (operands resolve by key within the section,
 * stored computed rows never feed other computed fields). Pure — DB writes and
 * change-log insertion happen in the caller.
 */
export function planValueEdit(args: {
  editedRow: StoredValueRow
  newValue: number
  reportValues: StoredValueRow[]
  fields: FieldConfigRow[]
  thresholds: ThresholdRow[]
}):
  | { ok: true; plan: ValueEditPlan }
  | { ok: false; error: string } {
  const { editedRow, newValue, reportValues, fields, thresholds } = args

  if (editedRow.field_type_snapshot === "computed") {
    return {
      ok: false,
      error:
        "Computed values cannot be edited directly — correct the source reading instead.",
    }
  }
  if (editedRow.field_type_snapshot !== "numeric") {
    return { ok: false, error: "Only numeric readings can be corrected." }
  }
  if (!Number.isFinite(newValue)) {
    return { ok: false, error: "Enter a valid number." }
  }

  const editedFlags = thresholdFlag(
    editedRow.field_id
      ? lookupThresholdRow(thresholds, editedRow.field_id, editedRow.equipment_id)
      : null,
    newValue,
  )
  const plan: ValueEditPlan = {
    edited: {
      id: editedRow.id,
      value_numeric: newValue,
      is_out_of_range: editedFlags.isOor,
      threshold_id: editedFlags.thresholdId,
      before: {
        value_numeric: editedRow.value_numeric,
        is_out_of_range: editedRow.is_out_of_range,
      },
    },
    recomputed: [],
    skipped: [],
  }

  // Without an active field config the edited reading has no key/section, so
  // no computed field can (safely) be recomputed from it.
  const editedCfg = fields.find((f) => f.id === editedRow.field_id)
  if (!editedCfg) return { ok: true, plan }

  const fieldById = new Map(fields.map((f) => [f.id, f]))
  const sectionCfgByKey = new Map<string, FieldConfigRow>()
  for (const f of fields) {
    if (f.section_id === editedCfg.section_id) sectionCfgByKey.set(f.key, f)
  }

  // Post-edit operand values for the section, keyed by field key. Stored
  // computed rows are excluded — computed results never feed other computed
  // fields (no chaining), matching submit-time behavior.
  const sectionValues = new Map<string, number>()
  for (const row of reportValues) {
    if (row.field_type_snapshot !== "numeric" || !row.field_id) continue
    const cfg = fieldById.get(row.field_id)
    if (!cfg || cfg.section_id !== editedCfg.section_id) continue
    const value = row.id === editedRow.id ? newValue : row.value_numeric
    if (value === null) continue
    sectionValues.set(cfg.key, value)
  }
  // The edited row itself might have been filtered above only if its config
  // vanished — it hasn't (editedCfg exists) — but ensure the new value wins.
  sectionValues.set(editedCfg.key, newValue)

  for (const field of fields) {
    if (field.field_type !== "computed") continue
    if (field.section_id !== editedCfg.section_id) continue
    const spec = parseComputedSpec(field.options)
    const problem = computedConfigProblem(field, spec, sectionCfgByKey)
    if (problem || !spec) {
      plan.skipped.push({ field, reason: problem ?? "invalid computed options" })
      continue
    }
    if (spec.a !== editedCfg.key && spec.b !== editedCfg.key) continue
    const result = evaluateComputed(spec, (k) =>
      sectionValues.has(k) ? (sectionValues.get(k) as number) : null,
    )
    if (result === null || !Number.isFinite(result)) continue

    const existing =
      reportValues.find(
        (r) =>
          r.field_id === field.id &&
          (r.equipment_id ?? null) === (field.equipment_id ?? null) &&
          r.field_type_snapshot === "computed",
      ) ?? null
    const flags = thresholdFlag(
      lookupThresholdRow(thresholds, field.id, field.equipment_id),
      result,
    )
    if (
      existing &&
      existing.value_numeric === result &&
      existing.is_out_of_range === flags.isOor &&
      existing.threshold_id === flags.thresholdId
    ) {
      continue // nothing changed; no write, no change-log noise
    }
    plan.recomputed.push({
      id: existing?.id ?? null,
      field,
      value_numeric: result,
      is_out_of_range: flags.isOor,
      threshold_id: flags.thresholdId,
      before: existing
        ? {
            value_numeric: existing.value_numeric,
            is_out_of_range: existing.is_out_of_range,
          }
        : null,
    })
  }

  return { ok: true, plan }
}

/** Json-compatible before/after payload stored in refrigeration_change_log. */
export type ChangeLogValuePayload = {
  report_value_id: string | null
  label: string
  value_numeric: number | null
  is_out_of_range: boolean | null
}

export type ChangeLogEntry = {
  facility_id: string
  report_id: string
  changed_by: string
  reason: string
  before: ChangeLogValuePayload
  after: ChangeLogValuePayload
}

/**
 * Materialize the append-only refrigeration_change_log rows for an applied
 * edit plan: one entry for the source correction (admin-supplied reason) and
 * one per recomputed dependent value (fixed reason, per spec).
 */
export function buildEditChangeLogEntries(
  plan: ValueEditPlan,
  ctx: {
    facilityId: string
    reportId: string
    changedBy: string
    reason: string
    editedLabel: string
  },
): ChangeLogEntry[] {
  const entries: ChangeLogEntry[] = [
    {
      facility_id: ctx.facilityId,
      report_id: ctx.reportId,
      changed_by: ctx.changedBy,
      reason: ctx.reason,
      before: {
        report_value_id: plan.edited.id,
        label: ctx.editedLabel,
        value_numeric: plan.edited.before.value_numeric,
        is_out_of_range: plan.edited.before.is_out_of_range,
      },
      after: {
        report_value_id: plan.edited.id,
        label: ctx.editedLabel,
        value_numeric: plan.edited.value_numeric,
        is_out_of_range: plan.edited.is_out_of_range,
      },
    },
  ]
  for (const r of plan.recomputed) {
    entries.push({
      facility_id: ctx.facilityId,
      report_id: ctx.reportId,
      changed_by: ctx.changedBy,
      reason: "recomputed: source value edited",
      before: {
        report_value_id: r.id,
        label: r.field.label,
        value_numeric: r.before?.value_numeric ?? null,
        is_out_of_range: r.before?.is_out_of_range ?? null,
      },
      after: {
        report_value_id: r.id,
        label: r.field.label,
        value_numeric: r.value_numeric,
        is_out_of_range: r.is_out_of_range,
      },
    })
  }
  return entries
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
