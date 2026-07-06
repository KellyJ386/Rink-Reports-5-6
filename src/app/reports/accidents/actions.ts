"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { requireUser } from "@/lib/auth"
import { getFacilityTimezone } from "@/lib/facility-timezone"
import { createClient } from "@/lib/supabase/server"
import { wallTimeToUtc } from "@/lib/timezone"
import { currentUserCan } from "@/lib/permissions/check"
import type { Database } from "@/types/database"

import type {
  AccidentReportSnapshot,
  BodyPartsPayloadEntry,
} from "./types"
import {
  ALLOWED_SIDES,
  buildInputFromForm,
  validateFields,
  type AccidentFieldName,
} from "./_lib/compute"
import { persistAccident } from "./_lib/submit"

type AccidentReportUpdate =
  Database["public"]["Tables"]["accident_reports"]["Update"]

export type { AccidentFieldName } from "./_lib/compute"

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

// =============================================================================
// Submit
// =============================================================================

export async function submitAccidentReport(
  _prev: AccidentFormState,
  formData: FormData
): Promise<AccidentFormState> {
  const fields = buildInputFromForm(formData)
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

  const result = await persistAccident(supabase, {
    employeeId: employeeRow.id,
    facilityId: employeeRow.facility_id,
    input: fields,
  })
  if (!result.ok) {
    return { ok: false, error: result.error }
  }

  const reportId = result.reportId
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
  const fields = buildInputFromForm(formData)
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
      "id, facility_id, employee_id, injured_person_name, injured_person_contact, injured_person_age, description, occurred_at, submitted_at, edit_window_ends_at, workers_comp, workers_comp_acknowledged_at, location_dropdown_id, activity_dropdown_id, severity_dropdown_id, medical_attention_dropdown_id, primary_injury_type_dropdown_id"
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
    .select("id, body_part_dropdown_id, side, laterality")
    .eq("accident_id", reportId)

  const existingBp = existingBpRaw ?? []

  // Existing witnesses (for snapshot + replace).
  const { data: existingWitnessesRaw } = await supabase
    .from("accident_witnesses")
    .select("id, name, contact, statement, sort_order")
    .eq("accident_id", reportId)
    .order("sort_order", { ascending: true })

  const existingWitnesses = existingWitnessesRaw ?? []

  // Interpret the reporter's wall clock in the facility timezone -> real UTC
  // instant (mirrors persistAccident; migration 174).
  const tz = await getFacilityTimezone(supabase, existing.facility_id)
  const occurredAt = wallTimeToUtc(fields.occurred_at, tz)
  if (!occurredAt) {
    return { ok: false, fieldErrors: { occurred_at: "Invalid date and time." } }
  }
  const occurredIso = occurredAt.toISOString()

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
    injured_person_age: existing.injured_person_age,
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
