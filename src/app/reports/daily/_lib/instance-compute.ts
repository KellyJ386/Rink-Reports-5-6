// Pure form-instance helpers for the Daily Reports form builder (migration
// 235): template-snapshot assembly/parsing, field-definition validation for
// the admin builder, and response validation against a frozen snapshot. NO
// server-only imports live here, so this module is unit-testable in isolation
// (see instance-compute.test.ts) and is re-used by the server-only
// `instances.ts` pipeline (which adds the Supabase I/O), mirroring the
// compute.ts / submit.ts split used by the legacy checklist flow.

export const FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "select",
  "multiselect",
  "checkbox",
  "time",
  "date",
] as const

export type FieldType = (typeof FIELD_TYPES)[number]

export const MAX_FIELDS_PER_TEMPLATE = 100
export const MAX_OPTIONS_PER_FIELD = 100
export const MAX_LABEL_LENGTH = 200
export const MAX_OPTION_LENGTH = 200
export const MAX_TITLE_LENGTH = 200
export const MAX_TEXT_LENGTH = 2000
export const MAX_TEXTAREA_LENGTH = 10000

/** One field as frozen into daily_report_instances.template_snapshot. */
export type SnapshotField = {
  id: string
  label: string
  field_type: FieldType
  options: string[] | null
  required: boolean
  sort_order: number
}

/**
 * The shape stored in daily_report_instances.template_snapshot: everything an
 * instance needs to render and validate WITHOUT re-reading the template
 * tables (which may have moved on to a newer version since).
 */
export type TemplateSnapshot = {
  template_id: string
  template_name: string
  version: number
  fields: SnapshotField[]
}

/** A validated response value, keyed by snapshot field id. */
export type ResponseValue = string | number | boolean | string[]
export type ResponsesMap = Record<string, ResponseValue>

function isFieldType(v: unknown): v is FieldType {
  return typeof v === "string" && (FIELD_TYPES as readonly string[]).includes(v)
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

// ============================================================================
// Field definitions (admin builder input)
// ============================================================================

/** A field definition as submitted by the admin form builder (untrusted). */
export type FieldDefInput = {
  label: string
  field_type: FieldType
  options: string[] | null
  required: boolean
}

export type ParseFieldDefsResult =
  | { ok: true; fields: FieldDefInput[] }
  | { ok: false; error: string }

/**
 * Validate the field list an admin submits when creating a template or
 * publishing a new version. Select-family fields require a non-empty, unique
 * option list; other types must not carry options. sort_order is assigned by
 * array position, so the client's ordering IS the field order.
 */
export function parseFieldDefs(raw: unknown): ParseFieldDefsResult {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "Fields must be a list." }
  }
  if (raw.length === 0) {
    return { ok: false, error: "A form needs at least one field." }
  }
  if (raw.length > MAX_FIELDS_PER_TEMPLATE) {
    return {
      ok: false,
      error: `A form may have at most ${MAX_FIELDS_PER_TEMPLATE} fields.`,
    }
  }

  const fields: FieldDefInput[] = []
  for (let i = 0; i < raw.length; i++) {
    const r = (raw[i] ?? {}) as Record<string, unknown>
    const label = str(r.label)
    if (!label) {
      return { ok: false, error: `Field ${i + 1}: a label is required.` }
    }
    if (label.length > MAX_LABEL_LENGTH) {
      return {
        ok: false,
        error: `Field ${i + 1}: label is too long (max ${MAX_LABEL_LENGTH} characters).`,
      }
    }
    if (!isFieldType(r.field_type)) {
      return { ok: false, error: `Field ${i + 1} ("${label}"): unknown field type.` }
    }
    const field_type = r.field_type
    const needsOptions = field_type === "select" || field_type === "multiselect"

    let options: string[] | null = null
    if (needsOptions) {
      if (!Array.isArray(r.options) || r.options.length === 0) {
        return {
          ok: false,
          error: `Field ${i + 1} ("${label}"): choice fields need at least one option.`,
        }
      }
      if (r.options.length > MAX_OPTIONS_PER_FIELD) {
        return {
          ok: false,
          error: `Field ${i + 1} ("${label}"): at most ${MAX_OPTIONS_PER_FIELD} options.`,
        }
      }
      const seen = new Set<string>()
      options = []
      for (const opt of r.options) {
        const o = str(opt)
        if (!o) {
          return {
            ok: false,
            error: `Field ${i + 1} ("${label}"): options cannot be blank.`,
          }
        }
        if (o.length > MAX_OPTION_LENGTH) {
          return {
            ok: false,
            error: `Field ${i + 1} ("${label}"): option is too long (max ${MAX_OPTION_LENGTH} characters).`,
          }
        }
        if (seen.has(o)) {
          return {
            ok: false,
            error: `Field ${i + 1} ("${label}"): duplicate option "${o}".`,
          }
        }
        seen.add(o)
        options.push(o)
      }
    } else if (Array.isArray(r.options) && r.options.length > 0) {
      return {
        ok: false,
        error: `Field ${i + 1} ("${label}"): only choice fields may have options.`,
      }
    }

    fields.push({ label, field_type, options, required: Boolean(r.required) })
  }
  return { ok: true, fields }
}

// ============================================================================
// Snapshot assembly / parsing
// ============================================================================

type TemplateRowLite = { id: string; name: string; version: number }
type FieldRowLite = {
  id: string
  label: string
  field_type: string
  options: unknown
  required: boolean
  sort_order: number
}

/**
 * Assemble the frozen snapshot from the template + its ACTIVE field rows at
 * instance-creation time. Options are re-narrowed to a string array here so a
 * malformed jsonb value can never enter a snapshot.
 */
export function buildTemplateSnapshot(
  template: TemplateRowLite,
  fieldRows: FieldRowLite[],
): TemplateSnapshot {
  const fields: SnapshotField[] = fieldRows
    .filter((f) => isFieldType(f.field_type))
    .map((f) => ({
      id: f.id,
      label: f.label,
      field_type: f.field_type as FieldType,
      options: Array.isArray(f.options)
        ? f.options.filter((o): o is string => typeof o === "string")
        : null,
      required: f.required,
      sort_order: f.sort_order,
    }))
    .sort((a, b) => a.sort_order - b.sort_order)
  return {
    template_id: template.id,
    template_name: template.name,
    version: template.version,
    fields,
  }
}

/**
 * Narrow an untrusted jsonb value (the stored template_snapshot column) back
 * into a TemplateSnapshot. Returns null when the stored value is not a valid
 * snapshot — callers treat that as a hard error rather than guessing.
 */
export function parseSnapshot(raw: unknown): TemplateSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const template_id = str(o.template_id)
  const template_name = typeof o.template_name === "string" ? o.template_name : ""
  const version = typeof o.version === "number" ? o.version : NaN
  if (!template_id || !template_name || !Number.isInteger(version)) return null
  if (!Array.isArray(o.fields)) return null

  const fields: SnapshotField[] = []
  for (const f of o.fields) {
    if (!f || typeof f !== "object") return null
    const r = f as Record<string, unknown>
    const id = str(r.id)
    const label = typeof r.label === "string" ? r.label : ""
    if (!id || !label || !isFieldType(r.field_type)) return null
    const options = Array.isArray(r.options)
      ? r.options.filter((x): x is string => typeof x === "string")
      : null
    fields.push({
      id,
      label,
      field_type: r.field_type,
      options,
      required: Boolean(r.required),
      sort_order: typeof r.sort_order === "number" ? r.sort_order : 0,
    })
  }
  return { template_id, template_name, version, fields }
}

// ============================================================================
// Response validation
// ============================================================================

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidDateString(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const [y, m, d] = s.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  )
}

/** Absent = null/undefined/blank string/empty array: not an answer. */
function isAbsent(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === "string" && v.trim() === "") return true
  if (Array.isArray(v) && v.length === 0) return true
  return false
}

export type ValidateResponsesResult =
  | { ok: true; responses: ResponsesMap }
  | { ok: false; error: string }

/**
 * Validate a responses object against the instance's frozen snapshot.
 *
 * mode "draft": partial saves are fine — absent values are simply omitted;
 * present values must still be well-typed (and select values in-options).
 * mode "submit": additionally every `required` field must carry an answer
 * (a required checkbox must be checked).
 *
 * Unknown field ids are rejected outright — responses are keyed strictly by
 * the snapshot's field ids, so junk keys can never be persisted.
 */
export function validateResponses(
  snapshot: TemplateSnapshot,
  raw: unknown,
  mode: "draft" | "submit",
): ValidateResponsesResult {
  if (raw === null || raw === undefined) raw = {}
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Invalid responses payload." }
  }
  const input = raw as Record<string, unknown>
  const byId = new Map(snapshot.fields.map((f) => [f.id, f]))

  for (const key of Object.keys(input)) {
    if (!byId.has(key)) {
      return { ok: false, error: "Responses reference an unknown field." }
    }
  }

  const cleaned: ResponsesMap = {}
  for (const field of snapshot.fields) {
    const value = input[field.id]

    if (isAbsent(value)) {
      if (mode === "submit" && field.required && field.field_type !== "checkbox") {
        return { ok: false, error: `"${field.label}" is required.` }
      }
      // A required checkbox with no stored value is unchecked → fails below
      // only when explicitly false too, so handle it here as unchecked.
      if (mode === "submit" && field.required && field.field_type === "checkbox") {
        return { ok: false, error: `"${field.label}" must be checked.` }
      }
      continue
    }

    switch (field.field_type) {
      case "text": {
        if (typeof value !== "string") {
          return { ok: false, error: `"${field.label}" must be text.` }
        }
        if (value.length > MAX_TEXT_LENGTH) {
          return {
            ok: false,
            error: `"${field.label}" is too long (max ${MAX_TEXT_LENGTH} characters).`,
          }
        }
        cleaned[field.id] = value.trim()
        break
      }
      case "textarea": {
        if (typeof value !== "string") {
          return { ok: false, error: `"${field.label}" must be text.` }
        }
        if (value.length > MAX_TEXTAREA_LENGTH) {
          return {
            ok: false,
            error: `"${field.label}" is too long (max ${MAX_TEXTAREA_LENGTH} characters).`,
          }
        }
        cleaned[field.id] = value.trim()
        break
      }
      case "number": {
        const n =
          typeof value === "number"
            ? value
            : typeof value === "string"
              ? Number(value.trim())
              : NaN
        if (!Number.isFinite(n)) {
          return { ok: false, error: `"${field.label}" must be a number.` }
        }
        cleaned[field.id] = n
        break
      }
      case "select": {
        if (typeof value !== "string" || !(field.options ?? []).includes(value)) {
          return {
            ok: false,
            error: `"${field.label}" must be one of the listed options.`,
          }
        }
        cleaned[field.id] = value
        break
      }
      case "multiselect": {
        if (
          !Array.isArray(value) ||
          value.some(
            (v) => typeof v !== "string" || !(field.options ?? []).includes(v),
          )
        ) {
          return {
            ok: false,
            error: `"${field.label}" selections must come from the listed options.`,
          }
        }
        cleaned[field.id] = Array.from(new Set(value as string[]))
        break
      }
      case "checkbox": {
        if (typeof value !== "boolean") {
          return { ok: false, error: `"${field.label}" must be a checkbox value.` }
        }
        if (mode === "submit" && field.required && value !== true) {
          return { ok: false, error: `"${field.label}" must be checked.` }
        }
        cleaned[field.id] = value
        break
      }
      case "time": {
        if (typeof value !== "string" || !TIME_RE.test(value.trim())) {
          return {
            ok: false,
            error: `"${field.label}" must be a time like 14:30.`,
          }
        }
        cleaned[field.id] = value.trim()
        break
      }
      case "date": {
        if (typeof value !== "string" || !isValidDateString(value.trim())) {
          return {
            ok: false,
            error: `"${field.label}" must be a date like 2026-08-09.`,
          }
        }
        cleaned[field.id] = value.trim()
        break
      }
    }
  }

  return { ok: true, responses: cleaned }
}

/** Validate an instance title (shared by create + save). */
export function parseTitle(raw: unknown):
  | { ok: true; title: string }
  | { ok: false; error: string } {
  const title = str(raw)
  if (!title) return { ok: false, error: "A title is required." }
  if (title.length > MAX_TITLE_LENGTH) {
    return {
      ok: false,
      error: `Title is too long (max ${MAX_TITLE_LENGTH} characters).`,
    }
  }
  return { ok: true, title }
}
