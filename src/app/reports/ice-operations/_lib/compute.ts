// Pure ice-operations submission helpers: payload/FormData parsing and per-op
// validation. NO server-only imports live here, so this module is safe to
// unit-test in isolation (see compute.test.ts) and is re-used by the
// server-only `submit.ts` (which adds the Supabase + notification I/O).
//
// Ice Operations routes FOUR operation types (ice_make, blade_change, edging,
// circle_check) through one submission pipeline. The normalized input carries
// the operation type as a discriminator plus that type's structured fields, so
// the online server action and the offline replay endpoint reconstruct the same
// shape.

import {
  isOperationType,
  OPERATION_REQUIRES_RINK,
  type OperationType,
} from "../types"

// ---------------------------------------------------------------------------
// Input model
// ---------------------------------------------------------------------------

export type IceMakeFields = {
  type: "ice_make"
  water_used_gal: number | null
  machine_hours: number | null
  snow_taken_pct: number | null
  time_in: string | null
  time_out: string | null
}

export type EdgingFields = {
  type: "edging"
  hours_run: number | null
}

export type BladeChangeFields = {
  type: "blade_change"
  blade_serial: string | null
  hours_at_change: number | null
  replaced_by_employee_id: string | null
}

/** A single circle-check checklist result, validated-shape. */
export type CircleCheckResult = {
  checklist_item_id: string | null
  label_snapshot: string
  passed: boolean
  failed_notes: string | null
}

export type CircleCheckFields = {
  type: "circle_check"
  results: CircleCheckResult[]
}

/** The per-op-type discriminated payload carried on the submission. */
export type IceOpsFields =
  | IceMakeFields
  | EdgingFields
  | BladeChangeFields
  | CircleCheckFields

/**
 * Normalized, validated-shape submission input shared by both entry points.
 * `operation_type` is the discriminator; `fields` carries that type's data.
 */
export type IceOpsInput = {
  operation_type: OperationType
  rink_id: string | null
  equipment_id: string | null
  /** ISO string of when the operation happened. */
  occurred_at: string | null
  notes: string | null
  fields: IceOpsFields
}

// ---------------------------------------------------------------------------
// Primitive parsers
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

/** Trimmed string or null (empty => null). */
function strOrNull(v: unknown): string | null {
  const s = str(v)
  return s.length > 0 ? s : null
}

/** Finite number from a string/number, else null. Mirrors the online action. */
function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  const s = str(v)
  if (s === "") return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// Keep the reporter's raw wall-clock string (datetime-local format) — the
// facility-timezone conversion to a real UTC instant happens in submit.ts
// (wallTimeToUtc, migration 174), which this pure module must not import.
function parseOccurredAt(v: unknown): string | null {
  const s = str(v)
  if (s === "") return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : s
}

// ---------------------------------------------------------------------------
// Circle-check results parsing
// ---------------------------------------------------------------------------

/**
 * Sentinel distinguishing "the client sent malformed JSON / a non-array" from
 * "the client sent an empty list". The online action previously surfaced the
 * former as an opaque `throw new Error("invalid results")`; callers now map this
 * to a clean user-facing validation error instead.
 */
export const INVALID_CIRCLE_RESULTS = Symbol("invalid_circle_results")

/**
 * Normalize a circle-check results array (already JSON-parsed). Returns the
 * sentinel when the input is not an array (the previously-opaque case), else the
 * cleaned list (skipping entries without a label).
 */
export function parseCircleResults(
  arr: unknown,
): CircleCheckResult[] | typeof INVALID_CIRCLE_RESULTS {
  if (!Array.isArray(arr)) return INVALID_CIRCLE_RESULTS
  const out: CircleCheckResult[] = []
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue
    const r = raw as Record<string, unknown>
    const itemId =
      typeof r.checklist_item_id === "string" ? r.checklist_item_id : null
    const label = str(r.label_snapshot)
    const passed = r.passed === true
    const failedNotes = str(r.failed_notes)
    if (!label) continue
    out.push({
      checklist_item_id: itemId,
      label_snapshot: label,
      passed,
      failed_notes: failedNotes.length > 0 ? failedNotes : null,
    })
  }
  return out
}

/** Parse circle-check results from a JSON string (online hidden input). */
function parseCircleResultsJson(
  raw: string,
): CircleCheckResult[] | typeof INVALID_CIRCLE_RESULTS {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return INVALID_CIRCLE_RESULTS
  }
  return parseCircleResults(parsed)
}

// ---------------------------------------------------------------------------
// Per-op field builders
// ---------------------------------------------------------------------------

function buildFields(
  operationType: OperationType,
  get: (key: string) => unknown,
): IceOpsFields | typeof INVALID_CIRCLE_RESULTS {
  switch (operationType) {
    case "ice_make":
      return {
        type: "ice_make",
        water_used_gal: numOrNull(get("water_used_gal")),
        machine_hours: numOrNull(get("machine_hours")),
        snow_taken_pct: numOrNull(get("snow_taken_pct")),
        time_in: strOrNull(get("time_in")),
        time_out: strOrNull(get("time_out")),
      }
    case "edging":
      return {
        type: "edging",
        hours_run: numOrNull(get("hours_run")),
      }
    case "blade_change":
      return {
        type: "blade_change",
        blade_serial: strOrNull(get("blade_serial")),
        hours_at_change: numOrNull(get("hours_at_change")),
        replaced_by_employee_id: strOrNull(get("replaced_by_employee_id")),
      }
    case "circle_check": {
      const rawResults = get("circle_check_results")
      // Accept either a parsed array (offline payload) or a JSON string
      // (online hidden input).
      const results =
        typeof rawResults === "string"
          ? parseCircleResultsJson(rawResults)
          : parseCircleResults(rawResults)
      if (results === INVALID_CIRCLE_RESULTS) return INVALID_CIRCLE_RESULTS
      return { type: "circle_check", results }
    }
  }
}

// ---------------------------------------------------------------------------
// Input builders (one per entry point) + a shared core
// ---------------------------------------------------------------------------

function buildInput(
  operationType: OperationType,
  get: (key: string) => unknown,
): IceOpsInput | null {
  const fields = buildFields(operationType, get)
  if (fields === INVALID_CIRCLE_RESULTS) return null
  return {
    operation_type: operationType,
    rink_id: strOrNull(get("rink_id")),
    equipment_id: strOrNull(get("equipment_id")),
    occurred_at: parseOccurredAt(get("occurred_at")),
    notes: strOrNull(get("notes")),
    fields,
  }
}

/**
 * Build from a parsed JSON object (offline replay). The operation type may be
 * carried on the object itself (`operation_type`) or supplied by the caller.
 * Returns null when the operation type is missing/unknown, or when the
 * circle-check results are malformed (non-array).
 */
export function buildInputFromObject(
  obj: unknown,
  operationTypeHint?: string,
): IceOpsInput | null {
  if (!obj || typeof obj !== "object") return null
  const o = obj as Record<string, unknown>
  const opRaw =
    operationTypeHint ??
    (typeof o.operation_type === "string" ? o.operation_type : "")
  if (!isOperationType(opRaw)) return null
  return buildInput(opRaw, (key) => o[key])
}

/**
 * Online path: the form posts FormData. `operationType` comes from the bound
 * server action; circle-check results arrive as a JSON string hidden input.
 */
export function buildInputFromForm(
  operationType: OperationType,
  formData: FormData,
): IceOpsInput | null {
  return buildInput(operationType, (key) => formData.get(key))
}

/** Offline path: the queued payload IS the input object (untrusted JSON). */
export function buildInputFromPayload(
  payload: Record<string, unknown>,
): IceOpsInput | null {
  return buildInputFromObject(payload)
}

// ---------------------------------------------------------------------------
// Validation (pure; runs identically online and offline)
// ---------------------------------------------------------------------------

/** Null (not provided) or a non-negative number. */
function isNullOrNonNegative(n: number | null): boolean {
  return n === null || n >= 0
}

/**
 * Per-op-type validation that needs no DB access. Returns an error message or
 * null. Facility-scoped reference checks (rink/equipment belong to facility)
 * live in `persistIceOperation`, not here.
 */
export function validateIceOpsInput(input: IceOpsInput): string | null {
  if (OPERATION_REQUIRES_RINK[input.operation_type] && !input.rink_id) {
    return "Please pick a rink."
  }

  // Equipment is required for every op type — there's no operation type without
  // a piece of equipment driving it.
  if (!input.equipment_id) {
    return "Please pick the equipment used."
  }

  if (!input.occurred_at) {
    return "Please choose when the operation happened."
  }

  // Numeric sanity (the form inputs carry min/max, but direct POSTs and
  // offline payloads don't go through them).
  switch (input.fields.type) {
    case "ice_make": {
      const f = input.fields
      if (
        !isNullOrNonNegative(f.water_used_gal) ||
        !isNullOrNonNegative(f.machine_hours)
      ) {
        return "Water used and machine hours can't be negative."
      }
      if (
        f.snow_taken_pct !== null &&
        (f.snow_taken_pct < 0 || f.snow_taken_pct > 100)
      ) {
        return "Snow taken must be between 0 and 100%."
      }
      break
    }
    case "edging":
      if (!isNullOrNonNegative(input.fields.hours_run)) {
        return "Hours run can't be negative."
      }
      break
    case "blade_change":
      if (!isNullOrNonNegative(input.fields.hours_at_change)) {
        return "Blade hours can't be negative."
      }
      break
    case "circle_check": {
      // An empty checklist would be recorded as a clean pass — reject it.
      if (input.fields.results.length === 0) {
        return "Complete at least one checklist item."
      }
      // Every failed item must carry an explanatory note.
      for (const r of input.fields.results) {
        if (!r.passed && !r.failed_notes) {
          return "Add a note explaining each failed checklist item."
        }
      }
      break
    }
  }

  return null
}
