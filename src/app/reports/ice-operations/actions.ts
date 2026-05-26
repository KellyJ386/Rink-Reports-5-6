"use server"

import { redirect } from "next/navigation"

import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import type { Json } from "@/types/database"

import {
  OPERATION_REQUIRES_RINK,
  isOperationType,
  type OperationType,
} from "./types"

export type SubmissionFormState = {
  error?: string
}

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

type SubmissionResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string }

const VALID_SEVERITIES = new Set(["warn", "high", "critical"])

function asTrimmedString(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : ""
}

function asOptionalNumber(v: FormDataEntryValue | null): number | null {
  const s = asTrimmedString(v)
  if (s === "") return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function buildOccurredAt(raw: string): Date | null {
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return d
}

async function performSubmit(
  operationType: OperationType,
  formData: FormData
): Promise<SubmissionResult> {
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
      error:
        "Your account isn't fully set up yet. Contact your administrator.",
    }
  }

  // Defense-in-depth permission check.
  const { data: perm } = await supabase
    .from("module_permissions")
    .select("can_submit")
    .eq("module_key", "ice_operations")
    .eq("employee_id", employeeRow.id)
    .maybeSingle()

  if (!perm?.can_submit) {
    return {
      ok: false,
      error:
        "You don't have permission to submit ice operations reports.",
    }
  }

  const facilityId = employeeRow.facility_id

  const rinkId = asTrimmedString(formData.get("rink_id")) || null
  const equipmentId = asTrimmedString(formData.get("equipment_id")) || null
  const occurredAtRaw = asTrimmedString(formData.get("occurred_at"))
  const notes = asTrimmedString(formData.get("notes"))

  if (OPERATION_REQUIRES_RINK[operationType] && !rinkId) {
    return { ok: false, error: "Please pick a rink." }
  }

  // Equipment is required for every op type — there's no operation type
  // without a piece of equipment driving it.
  if (!equipmentId) {
    return { ok: false, error: "Please pick the equipment used." }
  }

  const occurredAt = buildOccurredAt(occurredAtRaw)
  if (!occurredAt) {
    return { ok: false, error: "Please choose when the operation happened." }
  }

  // Verify rink + equipment belong to this facility (if provided).
  if (rinkId) {
    const { data: rinkRow } = await supabase
      .from("ice_operations_rinks")
      .select("id, facility_id, is_active")
      .eq("id", rinkId)
      .eq("facility_id", facilityId)
      .maybeSingle()
    if (!rinkRow || !rinkRow.is_active) {
      return { ok: false, error: "Selected rink is not available." }
    }
  }

  const { data: equipmentRow } = await supabase
    .from("ice_operations_equipment")
    .select("id, facility_id, is_active, equipment_type")
    .eq("id", equipmentId)
    .eq("facility_id", facilityId)
    .maybeSingle()

  if (!equipmentRow || !equipmentRow.is_active) {
    return { ok: false, error: "Selected equipment is not available." }
  }

  // Build per-op payload.
  let payload: Json
  switch (operationType) {
    case "ice_make": {
      const timeIn = asTrimmedString(formData.get("time_in")) || null
      const timeOut = asTrimmedString(formData.get("time_out")) || null
      const waterUsed = asOptionalNumber(formData.get("water_used_gal"))
      const machineHours = asOptionalNumber(formData.get("machine_hours"))
      const snowTakenPct = asOptionalNumber(formData.get("snow_taken_pct"))

      payload = {
        water_used_gal: waterUsed,
        machine_hours: machineHours,
        snow_taken_pct: snowTakenPct,
        time_in: timeIn,
        time_out: timeOut,
      }
      break
    }
    case "edging": {
      const hoursRun = asOptionalNumber(formData.get("hours_run"))
      payload = { hours_run: hoursRun }
      break
    }
    case "blade_change": {
      const bladeSerial =
        asTrimmedString(formData.get("blade_serial")) || null
      const hoursAtChange = asOptionalNumber(formData.get("hours_at_change"))
      const replacedBy =
        asTrimmedString(formData.get("replaced_by_employee_id")) || null
      payload = {
        blade_serial: bladeSerial,
        hours_at_change: hoursAtChange,
        replaced_by_employee_id: replacedBy,
      }
      break
    }
    case "circle_check": {
      payload = {}
      break
    }
  }

  // 1) Insert the submission shell.
  const { data: insertedSubmission, error: subErr } = await supabase
    .from("ice_operations_submissions")
    .insert({
      facility_id: facilityId,
      employee_id: employeeRow.id,
      operation_type: operationType,
      rink_id: rinkId,
      equipment_id: equipmentId,
      occurred_at: occurredAt.toISOString(),
      submitted_at: new Date().toISOString(),
      notes: notes.length > 0 ? notes : null,
      payload,
      has_failed_check: false,
      failed_count: 0,
    })
    .select("id")
    .single()

  if (subErr || !insertedSubmission) {
    return {
      ok: false,
      error: dbError(subErr, "Failed to submit ice operations report."),
    }
  }

  const submissionId = insertedSubmission.id

  // 2) Circle check results.
  if (operationType === "circle_check") {
    const resultsRaw = String(formData.get("circle_check_results") ?? "")
    type ParsedResult = {
      checklist_item_id: string | null
      label_snapshot: string
      passed: boolean
      failed_notes: string | null
    }
    const parsed: ParsedResult[] = []
    try {
      const arr = JSON.parse(resultsRaw) as unknown
      if (!Array.isArray(arr)) {
        throw new Error("invalid results")
      }
      for (const raw of arr) {
        if (!raw || typeof raw !== "object") continue
        const r = raw as Record<string, unknown>
        const itemId =
          typeof r.checklist_item_id === "string"
            ? r.checklist_item_id
            : null
        const label =
          typeof r.label_snapshot === "string" ? r.label_snapshot.trim() : ""
        const passed = r.passed === true
        const failedNotes =
          typeof r.failed_notes === "string" ? r.failed_notes.trim() : ""
        if (!label) continue
        parsed.push({
          checklist_item_id: itemId,
          label_snapshot: label,
          passed,
          failed_notes: failedNotes.length > 0 ? failedNotes : null,
        })
      }
    } catch {
      await supabase
        .from("ice_operations_submissions")
        .delete()
        .eq("id", submissionId)
      return { ok: false, error: "Invalid checklist data." }
    }

    // Required: every failed item must have notes text.
    for (const r of parsed) {
      if (!r.passed && !r.failed_notes) {
        await supabase
          .from("ice_operations_submissions")
          .delete()
          .eq("id", submissionId)
        return {
          ok: false,
          error: "Add a note explaining each failed checklist item.",
        }
      }
    }

    if (parsed.length > 0) {
      const rows = parsed.map((r) => ({
        facility_id: facilityId,
        submission_id: submissionId,
        checklist_item_id: r.checklist_item_id,
        label_snapshot: r.label_snapshot,
        passed: r.passed,
        failed_notes: r.failed_notes,
      }))
      const { error: resErr } = await supabase
        .from("ice_operations_circle_check_results")
        .insert(rows)
      if (resErr) {
        await supabase
          .from("ice_operations_submissions")
          .delete()
          .eq("id", submissionId)
        return {
          ok: false,
          error: dbError(resErr, "Failed to save checklist results."),
        }
      }
    }

    const failedCount = parsed.filter((r) => !r.passed).length
    const hasFailed = failedCount > 0

    if (hasFailed || parsed.length > 0) {
      await supabase
        .from("ice_operations_submissions")
        .update({
          has_failed_check: hasFailed,
          failed_count: failedCount,
        })
        .eq("id", submissionId)
    }

    // 3) Best-effort alert on any failure.
    if (hasFailed) {
      const { data: settings } = await supabase
        .from("ice_operations_settings")
        .select("alerts_enabled, default_alert_severity")
        .eq("facility_id", facilityId)
        .maybeSingle()

      const alertsEnabled = settings?.alerts_enabled ?? true
      if (alertsEnabled) {
        const severityRaw =
          settings?.default_alert_severity?.toLowerCase() ?? "high"
        const severity = VALID_SEVERITIES.has(severityRaw)
          ? severityRaw
          : "high"

        let rinkName: string | null = null
        if (rinkId) {
          const { data: r } = await supabase
            .from("ice_operations_rinks")
            .select("name")
            .eq("id", rinkId)
            .maybeSingle()
          rinkName = r?.name ?? null
        }

        const failed = parsed.filter((p) => !p.passed)
        const lines = failed.slice(0, 8).map((f) => {
          const note = f.failed_notes ?? ""
          const truncated =
            note.length > 120 ? `${note.slice(0, 120).trimEnd()}…` : note
          return `• ${f.label_snapshot}: ${truncated}`
        })
        const remainder = failed.length - lines.length
        const bodyParts = [...lines]
        if (remainder > 0) bodyParts.push(`…and ${remainder} more`)

        const titleSuffix = rinkName ? ` (${rinkName})` : ""

        // Best-effort. Failure does not roll back the submission.
        await supabase.from("communication_alerts").insert({
          facility_id: facilityId,
          source_module: "ice_operations",
          source_record_id: submissionId,
          severity,
          title: `Ice Operations: Circle Check failed${titleSuffix}`,
          body: bodyParts.join("\n"),
          created_by_employee_id: employeeRow.id,
          requires_acknowledgement: true,
        })
      }
    }
  }

  return {
    ok: true,
    redirectTo: `/reports/ice-operations/${operationType}/done?id=${submissionId}`,
  }
}

export async function submitIceOperationsReport(
  operationType: string,
  _prev: SubmissionFormState,
  formData: FormData
): Promise<SubmissionFormState> {
  if (!isOperationType(operationType)) {
    return { error: "Unknown operation type." }
  }
  const result = await performSubmit(operationType, formData)
  if (!result.ok) {
    return { error: result.error }
  }
  redirect(result.redirectTo)
}
