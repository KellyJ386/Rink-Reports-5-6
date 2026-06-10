// Pure incident-submission helpers: payload/form parsing, witness + space
// normalization, and field validation. NO server-only imports live here, so
// this module is safe to unit-test in isolation (see compute.test.ts) and is
// re-used by the server-only `submit.ts` (which adds the Supabase +
// notification I/O).

export const DESCRIPTION_MAX = 500
export const MAX_WITNESSES = 3

export type IncidentFieldName =
  | "reporter_name"
  | "reporter_phone"
  | "occurred_at"
  | "severity_level_id"
  | "description"

export type WitnessInput = {
  name: string
  phone: string | null
  email: string | null
  statement: string | null
}

export type IncidentInput = {
  reporter_name: string
  reporter_phone: string
  description: string
  occurred_at: string // raw datetime-local string
  severity_level_id: string
  activity_id: string
  activity_other: string
  location_other: string
  immediate_actions: string
  space_ids: string[]
  witnesses: WitnessInput[]
  witnessMissingContact: boolean
}

export type IncidentValidation = {
  fieldErrors: Partial<Record<IncidentFieldName, string>>
  error?: string
}

/** Result shape returned by the submit/update server actions to the form. */
export type SubmissionFormState = {
  error?: string
  fieldErrors?: Partial<Record<IncidentFieldName, string>>
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

function normalizeWitnesses(raw: unknown): {
  rows: WitnessInput[]
  missingContact: boolean
} {
  if (!Array.isArray(raw)) return { rows: [], missingContact: false }
  const rows: WitnessInput[] = []
  let missingContact = false
  for (const item of raw) {
    if (rows.length >= MAX_WITNESSES) break
    if (!item || typeof item !== "object") continue
    const obj = item as Record<string, unknown>
    const name = str(obj.name)
    if (!name) continue
    const phone = str(obj.phone)
    const email = str(obj.email)
    const statement = str(obj.statement)
    if (!phone && !email) {
      missingContact = true
      continue
    }
    rows.push({
      name,
      phone: phone || null,
      email: email || null,
      statement: statement || null,
    })
  }
  return { rows, missingContact }
}

function normalizeSpaceIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out = new Set<string>()
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) out.add(item.trim())
  }
  return Array.from(out)
}

/** Build a normalized input from the online form's FormData. */
export function buildInputFromForm(formData: FormData): IncidentInput {
  const get = (k: string) => String(formData.get(k) ?? "").trim()
  let witnessesRaw: unknown = []
  try {
    witnessesRaw = JSON.parse(String(formData.get("witnesses_json") ?? "[]"))
  } catch {
    witnessesRaw = []
  }
  let spacesRaw: unknown = []
  try {
    spacesRaw = JSON.parse(String(formData.get("spaces_json") ?? "[]"))
  } catch {
    spacesRaw = []
  }
  const { rows, missingContact } = normalizeWitnesses(witnessesRaw)
  return {
    reporter_name: get("reporter_name"),
    reporter_phone: get("reporter_phone"),
    description: get("description"),
    occurred_at: get("occurred_at"),
    severity_level_id: get("severity_level_id"),
    activity_id: get("activity_id"),
    activity_other: get("activity_other"),
    location_other: get("location_other"),
    immediate_actions: get("immediate_actions"),
    space_ids: normalizeSpaceIds(spacesRaw),
    witnesses: rows,
    witnessMissingContact: missingContact,
  }
}

/** Build a normalized input from a queued offline payload (untrusted JSON). */
export function buildInputFromPayload(raw: unknown): IncidentInput | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const { rows, missingContact } = normalizeWitnesses(obj.witnesses)
  return {
    reporter_name: str(obj.reporter_name),
    reporter_phone: str(obj.reporter_phone),
    description: str(obj.description),
    occurred_at: str(obj.occurred_at),
    severity_level_id: str(obj.severity_level_id),
    activity_id: str(obj.activity_id),
    activity_other: str(obj.activity_other),
    location_other: str(obj.location_other),
    immediate_actions: str(obj.immediate_actions),
    space_ids: normalizeSpaceIds(obj.space_ids),
    witnesses: rows,
    witnessMissingContact: missingContact,
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateIncidentInput(input: IncidentInput): IncidentValidation {
  const fieldErrors: Partial<Record<IncidentFieldName, string>> = {}
  if (!input.reporter_name) fieldErrors.reporter_name = "Please enter your name."
  if (!input.reporter_phone)
    fieldErrors.reporter_phone = "Please enter a phone number."
  if (!input.occurred_at) {
    fieldErrors.occurred_at = "Please choose when the incident happened."
  } else if (Number.isNaN(new Date(input.occurred_at).getTime())) {
    fieldErrors.occurred_at = "Invalid date and time."
  }
  if (!input.severity_level_id)
    fieldErrors.severity_level_id = "Please pick a severity level."
  if (!input.description) {
    fieldErrors.description = "Please describe what happened."
  } else if (input.description.length > DESCRIPTION_MAX) {
    fieldErrors.description = `Description must be ${DESCRIPTION_MAX} characters or fewer.`
  }

  let error: string | undefined
  if (input.witnessMissingContact) {
    error =
      "Each witness needs a name and at least one contact (phone or email)."
  } else if (input.space_ids.length === 0 && !input.location_other) {
    error = "Please choose at least one facility space (or add an “Other”)."
  }

  return { fieldErrors, error }
}
