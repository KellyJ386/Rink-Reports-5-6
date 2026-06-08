// Pure accident-submission helpers: payload/FormData parsing and field
// validation. NO server-only imports live here, so this module is safe to
// unit-test in isolation (see compute.test.ts) and is re-used by the
// server-only `submit.ts` (which adds DB + notification I/O).

import type {
  BodyPartsPayloadEntry,
  WitnessPayloadEntry,
} from "../types"

// Names match form input `name` attributes — keep them in sync with
// the submission-form component.
export type AccidentFieldName =
  | "injured_person_name"
  | "injured_person_contact"
  | "injured_person_age"
  | "occurred_at"
  | "description"

export const MAX_BODY_PARTS = 32
export const ALLOWED_SIDES = new Set(["front", "back", "both", "none"])
export const ALLOWED_LATERALITIES = new Set(["left", "right"])
export const MAX_WITNESSES = 5

/**
 * Normalized accident submission input. Mirrors the structured shape the online
 * action builds from its FormData, so the same value lands whether a submission
 * arrives online or via the offline replay endpoint.
 */
export type AccidentInput = {
  injured_person_name: string
  injured_person_contact: string
  injured_person_age: number | null
  description: string
  occurred_at: string
  location_dropdown_id: string | null
  activity_dropdown_id: string | null
  severity_dropdown_id: string | null
  medical_attention_dropdown_id: string | null
  primary_injury_type_dropdown_id: string | null
  workers_comp: boolean
  workers_comp_ack: boolean
  body_parts: BodyPartsPayloadEntry[]
  witnesses: WitnessPayloadEntry[]
}

// ---------------------------------------------------------------------------
// Body parts / witnesses parsing (shared, structure-only)
// ---------------------------------------------------------------------------

/**
 * Normalize an array of body-part entries (already JSON-parsed). Drops invalid
 * rows, ignores `side === "none"`, and dedupes on (region, laterality) — the DB
 * unique key is (accident_id, body_part_dropdown_id, side, laterality NULLS NOT
 * DISTINCT), so the first occurrence per (region, laterality) pair wins.
 */
export function normalizeBodyParts(parsed: unknown): BodyPartsPayloadEntry[] {
  if (!Array.isArray(parsed)) return []
  const out: BodyPartsPayloadEntry[] = []
  const seen = new Set<string>()
  for (const item of parsed) {
    if (out.length >= MAX_BODY_PARTS) break
    if (!item || typeof item !== "object") continue
    const obj = item as Record<string, unknown>
    const id =
      typeof obj.body_part_dropdown_id === "string"
        ? obj.body_part_dropdown_id
        : ""
    const side = typeof obj.side === "string" ? obj.side : ""
    if (!id || !ALLOWED_SIDES.has(side)) continue
    if (side === "none") continue
    const rawLat = obj.laterality
    let laterality: "left" | "right" | null = null
    if (typeof rawLat === "string" && ALLOWED_LATERALITIES.has(rawLat)) {
      laterality = rawLat as "left" | "right"
    } else if (rawLat !== null && rawLat !== undefined) {
      // Unknown laterality string — reject the row.
      continue
    }
    const dedupeKey = `${id}::${laterality ?? ""}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    out.push({
      body_part_dropdown_id: id,
      side: side as BodyPartsPayloadEntry["side"],
      laterality,
    })
  }
  return out
}

/** Parse a JSON string of body-part entries (online hidden-input path). */
export function parseBodyParts(raw: string): BodyPartsPayloadEntry[] {
  if (!raw.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  return normalizeBodyParts(parsed)
}

/** Normalize an array of witness entries (already JSON-parsed). */
export function normalizeWitnesses(parsed: unknown): WitnessPayloadEntry[] {
  if (!Array.isArray(parsed)) return []
  const out: WitnessPayloadEntry[] = []
  for (const item of parsed) {
    if (out.length >= MAX_WITNESSES) break
    if (!item || typeof item !== "object") continue
    const obj = item as Record<string, unknown>
    const name = typeof obj.name === "string" ? obj.name.trim() : ""
    if (!name) continue
    const contactRaw = typeof obj.contact === "string" ? obj.contact.trim() : ""
    const statementRaw =
      typeof obj.statement === "string" ? obj.statement.trim() : ""
    out.push({
      name,
      contact: contactRaw.length > 0 ? contactRaw : null,
      statement: statementRaw.length > 0 ? statementRaw : null,
    })
  }
  return out
}

/** Parse a JSON string of witness entries (online hidden-input path). */
export function parseWitnesses(raw: string): WitnessPayloadEntry[] {
  if (!raw.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  return normalizeWitnesses(parsed)
}

// ---------------------------------------------------------------------------
// Input builders
// ---------------------------------------------------------------------------

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

function optionalStr(v: unknown): string | null {
  const s = trimStr(v)
  return s.length > 0 ? s : null
}

function parseAge(v: unknown): number | null {
  const raw = trimStr(v)
  if (raw.length === 0) return null
  const parsed = Number(raw)
  if (Number.isFinite(parsed)) return Math.trunc(parsed)
  return null
}

/** Online path: reconstruct the structured input from the action's FormData. */
export function buildInputFromForm(formData: FormData): AccidentInput {
  return {
    injured_person_name: trimStr(formData.get("injured_person_name")),
    injured_person_contact: trimStr(formData.get("injured_person_contact")),
    injured_person_age: parseAge(formData.get("injured_person_age")),
    description: trimStr(formData.get("description")),
    occurred_at: trimStr(formData.get("occurred_at")),
    location_dropdown_id: optionalStr(formData.get("location_dropdown_id")),
    activity_dropdown_id: optionalStr(formData.get("activity_dropdown_id")),
    severity_dropdown_id: optionalStr(formData.get("severity_dropdown_id")),
    medical_attention_dropdown_id: optionalStr(
      formData.get("medical_attention_dropdown_id"),
    ),
    primary_injury_type_dropdown_id: optionalStr(
      formData.get("primary_injury_type_dropdown_id"),
    ),
    workers_comp: String(formData.get("workers_comp") ?? "") === "on",
    workers_comp_ack: String(formData.get("workers_comp_ack") ?? "") === "on",
    body_parts: parseBodyParts(String(formData.get("body_parts_json") ?? "")),
    witnesses: parseWitnesses(String(formData.get("witnesses_json") ?? "")),
  }
}

/**
 * Offline path: the queued payload IS the input object (untrusted JSON). Accepts
 * either a boolean or `"on"` for the workers-comp flags, and either already-
 * parsed arrays or JSON-string forms for body_parts / witnesses, so a payload
 * mirroring the FormData fields round-trips identically.
 */
export function buildInputFromPayload(
  payload: Record<string, unknown>,
): AccidentInput | null {
  if (!payload || typeof payload !== "object") return null
  const o = payload

  const boolFlag = (v: unknown): boolean =>
    v === true || v === "on" || v === "true"

  const arrayOrJson = (v: unknown): unknown => {
    if (Array.isArray(v)) return v
    if (typeof v === "string") {
      if (!v.trim()) return []
      try {
        return JSON.parse(v)
      } catch {
        return []
      }
    }
    return []
  }

  return {
    injured_person_name: trimStr(o.injured_person_name),
    injured_person_contact: trimStr(o.injured_person_contact),
    injured_person_age: parseAge(o.injured_person_age),
    description: trimStr(o.description),
    occurred_at: trimStr(o.occurred_at),
    location_dropdown_id: optionalStr(o.location_dropdown_id),
    activity_dropdown_id: optionalStr(o.activity_dropdown_id),
    severity_dropdown_id: optionalStr(o.severity_dropdown_id),
    medical_attention_dropdown_id: optionalStr(o.medical_attention_dropdown_id),
    primary_injury_type_dropdown_id: optionalStr(
      o.primary_injury_type_dropdown_id,
    ),
    workers_comp: boolFlag(o.workers_comp),
    workers_comp_ack: boolFlag(o.workers_comp_ack),
    body_parts: normalizeBodyParts(arrayOrJson(o.body_parts)),
    witnesses: normalizeWitnesses(arrayOrJson(o.witnesses)),
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Collect all per-field validation errors so the user can fix them in one pass.
 * Insertion order matches the visual order of the form so the auto-focus effect
 * picks the topmost invalid field.
 */
export function validateFields(
  fields: AccidentInput,
): Partial<Record<AccidentFieldName, string>> {
  const errors: Partial<Record<AccidentFieldName, string>> = {}
  if (!fields.injured_person_name)
    errors.injured_person_name = "Please enter the injured person's name."
  if (!fields.injured_person_contact)
    errors.injured_person_contact =
      "Please enter a contact for the injured person."
  if (fields.injured_person_age === null)
    errors.injured_person_age = "Please enter the injured person's age."
  else if (fields.injured_person_age < 0 || fields.injured_person_age > 120)
    errors.injured_person_age = "Age must be between 0 and 120."
  if (!fields.occurred_at)
    errors.occurred_at = "Please choose when the accident happened."
  else if (Number.isNaN(new Date(fields.occurred_at).getTime()))
    errors.occurred_at = "Invalid date and time."
  if (!fields.description) errors.description = "Please describe what happened."
  return errors
}

/** Map an accident severity dropdown key to a communication-alert severity. */
export function severityKeyToAlertSeverity(
  key: string | null | undefined,
): string {
  switch (key) {
    case "critical":
      return "critical"
    case "high":
      return "high"
    case "medium":
      return "warn"
    case "low":
      return "info"
    default:
      return "high"
  }
}
