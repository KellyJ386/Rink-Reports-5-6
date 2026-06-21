// Pure daily-report submission helpers: payload/form parsing and checklist-item
// validation. NO server-only imports live here, so this module is safe to
// unit-test in isolation (see compute.test.ts) and is re-used by the
// server-only `submit.ts` (which adds the Supabase + notification I/O).

/** A single checklist result the user (or a queued payload) submitted. */
export type SubmitItemInput = {
  checklist_item_id: string
  label_snapshot: string
  is_checked: boolean
}

/**
 * Normalized, validated-shape daily submission input shared by the online
 * action and the offline replay endpoint. `area_slug` is carried through so the
 * online action can build its done-page redirect; the replay path ignores it.
 */
export type DailyInput = {
  template_id: string
  area_id: string
  area_slug: string
  note: string
  items: SubmitItemInput[]
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

export type ParseItemsResult =
  | { ok: true; items: SubmitItemInput[] }
  | { ok: false; error: string }

/**
 * Parse the checklist items from their JSON-array form. Returns a clean,
 * user-facing error (rather than throwing) when the value isn't a JSON array —
 * this replaces the previously-opaque `throw new Error("not array")`.
 */
export function parseItems(raw: unknown): ParseItemsResult {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "Invalid form data." }
  }
  const items = raw.map((row) => {
    const r = (row ?? {}) as Record<string, unknown>
    return {
      checklist_item_id: String(r.checklist_item_id ?? ""),
      label_snapshot: String(r.label_snapshot ?? ""),
      is_checked: Boolean(r.is_checked),
    }
  })
  return { ok: true, items }
}

/** Parse the `items_json` hidden field; tolerates absent/blank as empty list. */
export function parseItemsJson(raw: unknown): ParseItemsResult {
  const text = typeof raw === "string" && raw.length > 0 ? raw : "[]"
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: "Invalid form data." }
  }
  return parseItems(parsed)
}

/**
 * Build a normalized input from a parsed JSON object (the offline queued
 * payload). Returns null when the object is missing the required identifiers or
 * carries malformed checklist items.
 */
export function buildInputFromObject(obj: unknown): DailyInput | null {
  if (!obj || typeof obj !== "object") return null
  const o = obj as Record<string, unknown>

  const template_id = str(o.template_id)
  const area_id = str(o.area_id)
  const area_slug = str(o.area_slug)
  if (!template_id || !area_id || !area_slug) return null

  // The payload may carry items as an already-parsed array (`items`) or as the
  // serialized hidden-field string (`items_json`), mirroring the online form.
  const itemsResult =
    o.items !== undefined ? parseItems(o.items) : parseItemsJson(o.items_json)
  if (!itemsResult.ok) return null

  return {
    template_id,
    area_id,
    area_slug,
    note: str(o.note),
    items: itemsResult.items,
  }
}

/** Offline path: the queued payload IS the input object (untrusted JSON). */
export function buildInputFromPayload(raw: unknown): DailyInput | null {
  return buildInputFromObject(raw)
}

/**
 * The facility-local "business date" (YYYY-MM-DD) for a given instant, used to
 * group a day's daily-report submissions so a same-day re-submit updates the
 * existing report. Falls back to UTC when the timezone is missing or invalid.
 */
export function businessDateInTimeZone(now: Date, timeZone: string | null): string {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now)
  try {
    return fmt(timeZone || "UTC")
  } catch {
    return fmt("UTC")
  }
}
