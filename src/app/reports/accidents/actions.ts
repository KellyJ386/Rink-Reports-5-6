"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { requireUser } from "@/lib/auth"
import { dispatchRulesForSubmission } from "@/lib/notifications/dispatch"
import { createClient } from "@/lib/supabase/server"

import type {
  AccidentReportSnapshot,
  BodyPartsPayloadEntry,
} from "./types"

export type AccidentFormState = {
  ok?: boolean
  error?: string
}

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

const MAX_BODY_PARTS = 24
const ALLOWED_SIDES = new Set(["front", "back", "both", "none"])

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
  const seen = new Set<string>()
  for (const item of parsed) {
    if (out.length >= MAX_BODY_PARTS) break
    if (!item || typeof item !== "object") continue
    const obj = item as Record<string, unknown>
    const id = typeof obj.body_part_dropdown_id === "string"
      ? obj.body_part_dropdown_id
      : ""
    const side = typeof obj.side === "string" ? obj.side : ""
    if (!id || !ALLOWED_SIDES.has(side)) continue
    if (side === "none") continue
    // Coalesce duplicates by id (DB has unique on accident_id+id+side; we keep
    // first occurrence).
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      body_part_dropdown_id: id,
      side: side as BodyPartsPayloadEntry["side"],
    })
  }
  return out
}

type FormFields = {
  injured_person_name: string
  injured_person_contact: string
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
}

function readFields(formData: FormData): FormFields {
  const optional = (k: string): string | null => {
    const v = String(formData.get(k) ?? "").trim()
    return v.length > 0 ? v : null
  }
  return {
    injured_person_name: String(formData.get("injured_person_name") ?? "").trim(),
    injured_person_contact: String(
      formData.get("injured_person_contact") ?? ""
    ).trim(),
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
  }
}

function validate(fields: FormFields): string | null {
  if (!fields.injured_person_name) return "Please enter the injured person's name."
  if (!fields.injured_person_contact)
    return "Please enter a contact for the injured person."
  if (!fields.description) return "Please describe what happened."
  if (!fields.occurred_at) return "Please choose when the accident happened."
  const occurred = new Date(fields.occurred_at)
  if (Number.isNaN(occurred.getTime())) return "Invalid date and time."
  return null
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
  const validationError = validate(fields)
  if (validationError) return { ok: false, error: validationError }

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

  const { data: perm } = await supabase
    .from("module_permissions")
    .select("can_submit")
    .eq("module_key", "accident_reports")
    .eq("employee_id", employeeRow.id)
    .maybeSingle()

  if (!perm?.can_submit) {
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

  // Insert accident_reports (omit edit_window_ends_at — DB sets default).
  const { data: inserted, error: insertErr } = await supabase
    .from("accident_reports")
    .insert({
      facility_id: employeeRow.facility_id,
      employee_id: employeeRow.id,
      injured_person_name: fields.injured_person_name,
      injured_person_contact: fields.injured_person_contact,
      description: fields.description,
      occurred_at: occurredIso,
      location_dropdown_id: fields.location_dropdown_id,
      activity_dropdown_id: fields.activity_dropdown_id,
      severity_dropdown_id: fields.severity_dropdown_id,
      medical_attention_dropdown_id: fields.medical_attention_dropdown_id,
      primary_injury_type_dropdown_id: fields.primary_injury_type_dropdown_id,
      workers_comp: fields.workers_comp,
      workers_comp_acknowledged_at: workersCompAckAt,
    })
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

  // Insert body part rows in batch.
  if (fields.body_parts.length > 0) {
    const rows = fields.body_parts.map((bp) => ({
      accident_id: reportId,
      facility_id: employeeRow.facility_id,
      body_part_dropdown_id: bp.body_part_dropdown_id,
      side: bp.side,
    }))
    const { error: bpErr } = await supabase
      .from("accident_body_part_selections")
      .insert(rows)
    if (bpErr) {
      return cleanupAndFail(
        dbError(bpErr, "Failed to save body part selections.")
      )
    }
  }

  // Build snapshot for change log.
  const snapshot: AccidentReportSnapshot = {
    id: inserted.id,
    facility_id: inserted.facility_id,
    employee_id: inserted.employee_id,
    injured_person_name: inserted.injured_person_name,
    injured_person_contact: inserted.injured_person_contact,
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

  void dispatchRulesForSubmission({
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
  const validationError = validate(fields)
  if (validationError) return { ok: false, error: validationError }

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

  // Existing body parts (for diff + snapshot.before).
  const { data: existingBpRaw } = await supabase
    .from("accident_body_part_selections")
    .select("id, body_part_dropdown_id, side")
    .eq("accident_id", reportId)

  const existingBp = existingBpRaw ?? []

  const occurredIso = new Date(fields.occurred_at).toISOString()

  // Stamp workers_comp_acknowledged_at if newly acknowledged.
  const nextWcAck = fields.workers_comp
    ? existing.workers_comp_acknowledged_at ??
      (fields.workers_comp_ack ? new Date().toISOString() : null)
    : null

  const { data: updated, error: updErr } = await supabase
    .from("accident_reports")
    .update({
      injured_person_name: fields.injured_person_name,
      injured_person_contact: fields.injured_person_contact,
      description: fields.description,
      occurred_at: occurredIso,
      location_dropdown_id: fields.location_dropdown_id,
      activity_dropdown_id: fields.activity_dropdown_id,
      severity_dropdown_id: fields.severity_dropdown_id,
      medical_attention_dropdown_id: fields.medical_attention_dropdown_id,
      primary_injury_type_dropdown_id: fields.primary_injury_type_dropdown_id,
      workers_comp: fields.workers_comp,
      workers_comp_acknowledged_at: nextWcAck,
    })
    .eq("id", reportId)
    .select(
      "id, facility_id, employee_id, injured_person_name, injured_person_contact, description, occurred_at, submitted_at, edit_window_ends_at, workers_comp, workers_comp_acknowledged_at, location_dropdown_id, activity_dropdown_id, severity_dropdown_id, medical_attention_dropdown_id, primary_injury_type_dropdown_id"
    )
    .single()

  if (updErr || !updated) {
    return { ok: false, error: dbError(updErr, "Failed to update report.") }
  }

  // Reconcile body parts.
  const desired = new Map<string, BodyPartsPayloadEntry>()
  for (const bp of fields.body_parts) {
    desired.set(bp.body_part_dropdown_id, bp)
  }
  const existingMap = new Map<
    string,
    { id: string; side: string }
  >()
  for (const row of existingBp) {
    existingMap.set(row.body_part_dropdown_id, {
      id: row.id,
      side: row.side,
    })
  }

  const toDelete: string[] = []
  const toInsert: Array<{
    accident_id: string
    facility_id: string
    body_part_dropdown_id: string
    side: string
  }> = []
  const toUpdate: Array<{ id: string; side: string }> = []

  for (const [bpId, ex] of existingMap) {
    if (!desired.has(bpId)) {
      toDelete.push(ex.id)
    }
  }
  for (const [bpId, want] of desired) {
    const ex = existingMap.get(bpId)
    if (!ex) {
      toInsert.push({
        accident_id: reportId,
        facility_id: existing.facility_id,
        body_part_dropdown_id: bpId,
        side: want.side,
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
    const { error } = await supabase
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

  const beforeSnapshot: AccidentReportSnapshot = {
    id: existing.id,
    facility_id: existing.facility_id,
    employee_id: existing.employee_id,
    injured_person_name: existing.injured_person_name,
    injured_person_contact: existing.injured_person_contact,
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
    })),
  }
  const afterSnapshot: AccidentReportSnapshot = {
    id: updated.id,
    facility_id: updated.facility_id,
    employee_id: updated.employee_id,
    injured_person_name: updated.injured_person_name,
    injured_person_contact: updated.injured_person_contact,
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
