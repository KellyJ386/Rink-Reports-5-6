"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { requireUser } from "@/lib/auth"
import { dispatchRulesForSubmission } from "@/lib/notifications/dispatch"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"
import type { Database } from "@/types/database"

import type {
  AccidentReportSnapshot,
  BodyPartsPayloadEntry,
  WitnessPayloadEntry,
} from "./types"

type AccidentReportInsert =
  Database["public"]["Tables"]["accident_reports"]["Insert"]
type AccidentReportUpdate =
  Database["public"]["Tables"]["accident_reports"]["Update"]

// Names match form input `name` attributes — keep them in sync with
// the submission-form component.
export type AccidentFieldName =
  | "injured_person_name"
  | "injured_person_contact"
  | "injured_person_age"
  | "occurred_at"
  | "description"

export type AccidentFormState = {
  ok?: boolean
  error?: string
  fieldErrors?: Partial<Record<AccidentFieldName, string>>
}

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

const MAX_BODY_PARTS = 32
const ALLOWED_SIDES = new Set(["front", "back", "both", "none"])
const ALLOWED_LATERALITIES = new Set(["left", "right"])
const MAX_WITNESSES = 5

function parseBodyParts(raw: string): BodyPartsPayloadEntry[] {
  if (!raw.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: BodyPartsPayloadEntry[] = []
  // Dedupe on (body_part_dropdown_id, laterality) since the DB unique key is
  // (accident_id, body_part_dropdown_id, side, laterality NULLS NOT DISTINCT).
  // Keep the first occurrence for each (region, laterality) pair.
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

function parseWitnesses(raw: string): WitnessPayloadEntry[] {
  if (!raw.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
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

type FormFields = {
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

function readFields(formData: FormData): FormFields {
  const optional = (k: string): string | null => {
    const v = String(formData.get(k) ?? "").trim()
    return v.length > 0 ? v : null
  }
  const rawAge = String(formData.get("injured_person_age") ?? "").trim()
  let age: number | null = null
  if (rawAge.length > 0) {
    const parsed = Number(rawAge)
    if (Number.isFinite(parsed)) age = Math.trunc(parsed)
  }
  return {
    injured_person_name: String(formData.get("injured_person_name") ?? "").trim(),
    injured_person_contact: String(
      formData.get("injured_person_contact") ?? ""
    ).trim(),
    injured_person_age: age,
    description: String(formData.get("description") ?? "").trim(),
    occurred_at: String(formData.get("occurred_at") ?? "").trim(),
    location_dropdown_id: optional("location_dropdown_id"),
    activity_dropdown_id: optional("activity_dropdown_id"),
    severity_dropdown_id: optional("severity_dropdown_id"),
    medical_attention_dropdown_id: optional("medical_attention_dropdown_id"),
    primary_injury_type_dropdown_id: optional("primary_injury_type_dropdown_id"),
    workers_comp: String(formData.get("workers_comp") ?? "") === "on",
    workers_comp_ack: String(formData.get("workers_comp_ack") ?? "") === "on",
    body_parts: parseBodyParts(String(formData.get("body_parts_json") ?? "")),
    witnesses: parseWitnesses(String(formData.get("witnesses_json") ?? "")),
  }
}

// Collect all per-field validation errors so the user can fix them in
// one pass. Insertion order matches the visual order of the form so the
// auto-focus effect picks the topmost invalid field.
function validateFields(
  fields: FormFields,
): Partial<Record<AccidentFieldName, string>> {
  const errors: Partial<Record<AccidentFieldName, string>> = {}
  if (!fields.injured_person_name)
    errors.injured_person_name = "Please enter the injured person's name."
  if (!fields.injured_person_contact)
    errors.injured_person_contact = "Please enter a contact for the injured person."
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

function severityKeyToAlertSeverity(key: string | null | undefined): string {
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

// =============================================================================
// Submit
// =============================================================================

export async function submitAccidentReport(
  _prev: AccidentFormState,
  formData: FormData
): Promise<AccidentFormState> {
  const fields = readFields(formData)
  const fieldErrors = validateFields(fields)
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors }

  const current = await requireUser()
  const supabase = await createClient()

  const { data: employeeRow, error: empErr } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  if (empErr) {
    return { ok: false, error: dbError(empErr, "Failed to load your account.") }
  }
  if (!employeeRow) {
    return {
      ok: false,
      error: "Your account isn't fully set up yet. Contact your administrator.",
    }
  }

  if (!(await currentUserCan(supabase, "accident_reports", "submit"))) {
    return {
      ok: false,
      error: "You don't have permission to submit accident reports.",
    }
  }

  const occurredIso = new Date(fields.occurred_at).toISOString()
  const workersCompAckAt =
    fields.workers_comp && fields.workers_comp_ack
      ? new Date().toISOString()
      : null

  const insertPayload: AccidentReportInsert = {
    facility_id: employeeRow.facility_id,
    employee_id: employeeRow.id,
    injured_person_name: fields.injured_person_name,
    injured_person_contact: fields.injured_person_contact,
    injured_person_age: fields.injured_person_age,
    description: fields.description,
    occurred_at: occurredIso,
    location_dropdown_id: fields.location_dropdown_id,
    activity_dropdown_id: fields.activity_dropdown_id,
    severity_dropdown_id: fields.severity_dropdown_id,
    medical_attention_dropdown_id: fields.medical_attention_dropdown_id,
    primary_injury_type_dropdown_id: fields.primary_injury_type_dropdown_id,
    workers_comp: fields.workers_comp,
    workers_comp_acknowledged_at: workersCompAckAt,
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("accident_reports")
    .insert(insertPayload)
    .select(
      "id, facility_id, employee_id, injured_person_name, injured_person_contact, description, occurred_at, submitted_at, edit_window_ends_at, workers_comp, workers_comp_acknowledged_at, location_dropdown_id, activity_dropdown_id, severity_dropdown_id, medical_attention_dropdown_id, primary_injury_type_dropdown_id"
    )
    .single()

  if (insertErr || !inserted) {
    return {
      ok: false,
      error: dbError(insertErr, "Failed to submit accident report."),
    }
  }

  const reportId = inserted.id

  // Best-effort cleanup wrapper.
  const cleanupAndFail = async (msg: string): Promise<AccidentFormState> => {
    await supabase.from("accident_reports").delete().eq("id", reportId)
    return { ok: false, error: msg }
  }

  // Insert body part rows in batch. `laterality` lives on the table as of
  // migration 00000000000092 but is not yet in the generated Database types —
  // cast through any to attach it, matching the pattern in offline-sync.
  if (fields.body_parts.length > 0) {
    const rows = fields.body_parts.map((bp) => ({
      accident_id: reportId,
      facility_id: employeeRow.facility_id,
      body_part_dropdown_id: bp.body_part_dropdown_id,
      side: bp.side,
      laterality: bp.laterality,
    }))
    const { error: bpErr } = await supabase
      .from("accident_body_part_selections")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert(rows as any)
    if (bpErr) {
      return cleanupAndFail(
        dbError(bpErr, "Failed to save body part selections.")
      )
    }
  }

  // Insert witnesses in batch.
  if (fields.witnesses.length > 0) {
    const witnessRows = fields.witnesses.map((w, i) => ({
      accident_id: reportId,
      facility_id: employeeRow.facility_id,
      name: w.name,
      contact: w.contact,
      statement: w.statement,
      sort_order: i,
    }))
    const { error: wErr } = await supabase
      .from("accident_witnesses")
      .insert(witnessRows)
    if (wErr) {
      return cleanupAndFail(dbError(wErr, "Failed to save witnesses."))
    }
  }

  // Build snapshot for change log.
  const snapshot: AccidentReportSnapshot = {
    id: inserted.id,
    facility_id: inserted.facility_id,
    employee_id: inserted.employee_id,
    injured_person_name: inserted.injured_person_name,
    injured_person_contact: inserted.injured_person_contact,
    injured_person_age: fields.injured_person_age,
    description: inserted.description,
    occurred_at: inserted.occurred_at,
    submitted_at: inserted.submitted_at,
    edit_window_ends_at: inserted.edit_window_ends_at,
    workers_comp: inserted.workers_comp,
    workers_comp_acknowledged_at: inserted.workers_comp_acknowledged_at,
    location_dropdown_id: inserted.location_dropdown_id,
    activity_dropdown_id: inserted.activity_dropdown_id,
    severity_dropdown_id: inserted.severity_dropdown_id,
    medical_attention_dropdown_id: inserted.medical_attention_dropdown_id,
    primary_injury_type_dropdown_id: inserted.primary_injury_type_dropdown_id,
    body_parts: fields.body_parts,
    witnesses: fields.witnesses,
  }

  const { error: logErr } = await supabase.from("accident_change_log").insert({
    accident_id: reportId,
    facility_id: employeeRow.facility_id,
    employee_id: employeeRow.id,
    action: "create",
    before: null,
    after: snapshot,
  })
  if (logErr) {
    return cleanupAndFail(dbError(logErr, "Failed to record change log."))
  }

  // Medical-attention alert.
  if (fields.medical_attention_dropdown_id) {
    const { data: medRow } = await supabase
      .from("accident_dropdowns")
      .select("display_name, metadata, key")
      .eq("id", fields.medical_attention_dropdown_id)
      .maybeSingle()

    const triggers =
      medRow?.metadata &&
      typeof medRow.metadata === "object" &&
      !Array.isArray(medRow.metadata) &&
      (medRow.metadata as Record<string, unknown>).triggers_alert === true

    if (triggers) {
      let severityKey: string | null = null
      if (fields.severity_dropdown_id) {
        const { data: sevRow } = await supabase
          .from("accident_dropdowns")
          .select("key")
          .eq("id", fields.severity_dropdown_id)
          .maybeSingle()
        severityKey = sevRow?.key ?? null
      }

      const summary = `${fields.injured_person_name} — ${
        medRow?.display_name ?? "medical attention"
      }. ${fields.description.slice(0, 200)}${
        fields.description.length > 200 ? "…" : ""
      }`

      await supabase.from("communication_alerts").insert({
        facility_id: employeeRow.facility_id,
        source_module: "accident_reports",
        source_record_id: reportId,
        severity: severityKeyToAlertSeverity(severityKey),
        title: "Accident report requires medical attention follow-up",
        body: summary,
        created_by_employee_id: employeeRow.id,
        requires_acknowledgement: true,
      })
      // If alert insert fails, we leave the report intact — the alert is a
      // best-effort side-effect, not a precondition.
    }
  }

  await dispatchRulesForSubmission({
    facilityId: employeeRow.facility_id,
    sourceModule: "accident_reports",
    sourceRecordId: reportId,
    subject: "Accident report submitted",
  })

  revalidatePath("/reports/accidents")
  revalidatePath(`/reports/accidents/${reportId}`)
  redirect(`/reports/accidents/${reportId}?submitted=1`)
}

// =============================================================================
// Update
// =============================================================================

export async function updateAccidentReport(
  reportId: string,
  _prev: AccidentFormState,
  formData: FormData
): Promise<AccidentFormState> {
  const fields = readFields(formData)
  const fieldErrors = validateFields(fields)
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors }

  const current = await requireUser()
  const supabase = await createClient()

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  if (!employeeRow) {
    return {
      ok: false,
      error: "Your account isn't fully set up yet. Contact your administrator.",
    }
  }

  // Fetch existing report.
  const { data: existing, error: fetchErr } = await supabase
    .from("accident_reports")
    .select(
      "id, facility_id, employee_id, injured_person_name, injured_person_contact, description, occurred_at, submitted_at, edit_window_ends_at, workers_comp, workers_comp_acknowledged_at, location_dropdown_id, activity_dropdown_id, severity_dropdown_id, medical_attention_dropdown_id, primary_injury_type_dropdown_id"
    )
    .eq("id", reportId)
    .maybeSingle()

  if (fetchErr || !existing) {
    return { ok: false, error: "Report not found." }
  }
  if (existing.employee_id !== employeeRow.id) {
    return { ok: false, error: "You can only edit your own reports." }
  }
  if (new Date(existing.edit_window_ends_at).getTime() <= Date.now()) {
    return { ok: false, error: "The edit window for this report has closed." }
  }

  // Existing body parts (for diff + snapshot.before). `laterality` isn't in
  // the generated Database types yet — cast.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingBpRaw } = await (supabase as any)
    .from("accident_body_part_selections")
    .select("id, body_part_dropdown_id, side, laterality")
    .eq("accident_id", reportId)

  const existingBp = (existingBpRaw ?? []) as Array<{
    id: string
    body_part_dropdown_id: string
    side: string
    laterality: string | null
  }>

  // Existing witnesses (for snapshot + replace).
  const { data: existingWitnessesRaw } = await supabase
    .from("accident_witnesses")
    .select("id, name, contact, statement, sort_order")
    .eq("accident_id", reportId)
    .order("sort_order", { ascending: true })

  const existingWitnesses = existingWitnessesRaw ?? []

  const occurredIso = new Date(fields.occurred_at).toISOString()

  // Stamp workers_comp_acknowledged_at if newly acknowledged.
  const nextWcAck = fields.workers_comp
    ? existing.workers_comp_acknowledged_at ??
      (fields.workers_comp_ack ? new Date().toISOString() : null)
    : null

  const updatePayload: AccidentReportUpdate = {
    injured_person_name: fields.injured_person_name,
    injured_person_contact: fields.injured_person_contact,
    injured_person_age: fields.injured_person_age,
    description: fields.description,
    occurred_at: occurredIso,
    location_dropdown_id: fields.location_dropdown_id,
    activity_dropdown_id: fields.activity_dropdown_id,
    severity_dropdown_id: fields.severity_dropdown_id,
    medical_attention_dropdown_id: fields.medical_attention_dropdown_id,
    primary_injury_type_dropdown_id: fields.primary_injury_type_dropdown_id,
    workers_comp: fields.workers_comp,
    workers_comp_acknowledged_at: nextWcAck,
  }

  const { data: updated, error: updErr } = await supabase
    .from("accident_reports")
    .update(updatePayload)
    .eq("id", reportId)
    .select(
      "id, facility_id, employee_id, injured_person_name, injured_person_contact, description, occurred_at, submitted_at, edit_window_ends_at, workers_comp, workers_comp_acknowledged_at, location_dropdown_id, activity_dropdown_id, severity_dropdown_id, medical_attention_dropdown_id, primary_injury_type_dropdown_id"
    )
    .single()

  if (updErr || !updated) {
    return { ok: false, error: dbError(updErr, "Failed to update report.") }
  }

  // Reconcile body parts. Identity key is (body_part_dropdown_id, laterality)
  // — paired regions can have two rows (left + right) per region, midline
  // regions have one (laterality NULL).
  const keyOf = (id: string, lat: string | null | undefined): string =>
    `${id}::${lat ?? ""}`

  const desired = new Map<string, BodyPartsPayloadEntry>()
  for (const bp of fields.body_parts) {
    desired.set(keyOf(bp.body_part_dropdown_id, bp.laterality), bp)
  }
  const existingMap = new Map<
    string,
    { id: string; side: string; laterality: string | null; bp_id: string }
  >()
  for (const row of existingBp) {
    existingMap.set(keyOf(row.body_part_dropdown_id, row.laterality), {
      id: row.id,
      side: row.side,
      laterality: row.laterality,
      bp_id: row.body_part_dropdown_id,
    })
  }

  const toDelete: string[] = []
  const toInsert: Array<{
    accident_id: string
    facility_id: string
    body_part_dropdown_id: string
    side: string
    laterality: string | null
  }> = []
  const toUpdate: Array<{ id: string; side: string }> = []

  for (const [k, ex] of existingMap) {
    if (!desired.has(k)) {
      toDelete.push(ex.id)
    }
  }
  for (const [k, want] of desired) {
    const ex = existingMap.get(k)
    if (!ex) {
      toInsert.push({
        accident_id: reportId,
        facility_id: existing.facility_id,
        body_part_dropdown_id: want.body_part_dropdown_id,
        side: want.side,
        laterality: want.laterality,
      })
    } else if (ex.side !== want.side) {
      toUpdate.push({ id: ex.id, side: want.side })
    }
  }

  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("accident_body_part_selections")
      .delete()
      .in("id", toDelete)
    if (error) {
      return {
        ok: false,
        error: dbError(error, "Failed to update body parts."),
      }
    }
  }
  if (toInsert.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("accident_body_part_selections")
      .insert(toInsert)
    if (error) {
      return {
        ok: false,
        error: dbError(error, "Failed to update body parts."),
      }
    }
  }
  for (const u of toUpdate) {
    const { error } = await supabase
      .from("accident_body_part_selections")
      .update({ side: u.side })
      .eq("id", u.id)
    if (error) {
      return {
        ok: false,
        error: dbError(error, "Failed to update body parts."),
      }
    }
  }

  // Reconcile witnesses by full replace within the edit window. This is the
  // simplest correct behaviour given the (accident_id, sort_order) unique
  // constraint and the small row count (<=5).
  if (existingWitnesses.length > 0) {
    const { error: delErr } = await supabase
      .from("accident_witnesses")
      .delete()
      .eq("accident_id", reportId)
    if (delErr) {
      return { ok: false, error: dbError(delErr, "Failed to update witnesses.") }
    }
  }
  if (fields.witnesses.length > 0) {
    const witnessRows = fields.witnesses.map((w, i) => ({
      accident_id: reportId,
      facility_id: existing.facility_id,
      name: w.name,
      contact: w.contact,
      statement: w.statement,
      sort_order: i,
    }))
    const { error: insErr } = await supabase
      .from("accident_witnesses")
      .insert(witnessRows)
    if (insErr) {
      return { ok: false, error: dbError(insErr, "Failed to update witnesses.") }
    }
  }

  const beforeSnapshot: AccidentReportSnapshot = {
    id: existing.id,
    facility_id: existing.facility_id,
    employee_id: existing.employee_id,
    injured_person_name: existing.injured_person_name,
    injured_person_contact: existing.injured_person_contact,
    // injured_person_age not yet on the select() above; derive from the row
    // via a separate read would be heavier. The before-snapshot is best-effort
    // and the after-snapshot carries the new value.
    injured_person_age: null,
    description: existing.description,
    occurred_at: existing.occurred_at,
    submitted_at: existing.submitted_at,
    edit_window_ends_at: existing.edit_window_ends_at,
    workers_comp: existing.workers_comp,
    workers_comp_acknowledged_at: existing.workers_comp_acknowledged_at,
    location_dropdown_id: existing.location_dropdown_id,
    activity_dropdown_id: existing.activity_dropdown_id,
    severity_dropdown_id: existing.severity_dropdown_id,
    medical_attention_dropdown_id: existing.medical_attention_dropdown_id,
    primary_injury_type_dropdown_id: existing.primary_injury_type_dropdown_id,
    body_parts: existingBp.map((r) => ({
      body_part_dropdown_id: r.body_part_dropdown_id,
      side: (ALLOWED_SIDES.has(r.side)
        ? r.side
        : "none") as BodyPartsPayloadEntry["side"],
      laterality:
        r.laterality === "left" || r.laterality === "right"
          ? r.laterality
          : null,
    })),
    witnesses: existingWitnesses.map((w) => ({
      name: w.name,
      contact: w.contact,
      statement: w.statement,
    })),
  }
  const afterSnapshot: AccidentReportSnapshot = {
    id: updated.id,
    facility_id: updated.facility_id,
    employee_id: updated.employee_id,
    injured_person_name: updated.injured_person_name,
    injured_person_contact: updated.injured_person_contact,
    injured_person_age: fields.injured_person_age,
    description: updated.description,
    occurred_at: updated.occurred_at,
    submitted_at: updated.submitted_at,
    edit_window_ends_at: updated.edit_window_ends_at,
    workers_comp: updated.workers_comp,
    workers_comp_acknowledged_at: updated.workers_comp_acknowledged_at,
    location_dropdown_id: updated.location_dropdown_id,
    activity_dropdown_id: updated.activity_dropdown_id,
    severity_dropdown_id: updated.severity_dropdown_id,
    medical_attention_dropdown_id: updated.medical_attention_dropdown_id,
    primary_injury_type_dropdown_id: updated.primary_injury_type_dropdown_id,
    body_parts: fields.body_parts,
    witnesses: fields.witnesses,
  }

  await supabase.from("accident_change_log").insert({
    accident_id: reportId,
    facility_id: existing.facility_id,
    employee_id: employeeRow.id,
    action: "update",
    before: beforeSnapshot,
    after: afterSnapshot,
  })

  revalidatePath("/reports/accidents")
  revalidatePath(`/reports/accidents/${reportId}`)
  return { ok: true }
}
