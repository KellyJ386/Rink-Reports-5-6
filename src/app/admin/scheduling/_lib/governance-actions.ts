"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/observability/log-server-error"
import type { Json } from "@/types/database"

import { formatViolations } from "./enforcement"
import {
  isComplianceRuleType,
  type CreateComplianceRuleInput,
  type SchedulingSettingsInput,
  type UpdateComplianceRulePatch,
} from "./governance-types"
import type { ActionState } from "./types"



// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  if (err.code === "23505") {
    return "That value conflicts with an existing record (duplicate)."
  }
  if (err.code === "23503") {
    return "Related record not found or referenced by another row."
  }
  // Exclusion-constraint backstop (migration 140): a write that would
  // double-book the employee. Reuse the app-side 'double_booked' copy so the
  // DB last-line-of-defense reads the same as the pre-validation.
  if (err.code === "23P01") {
    return formatViolations(["double_booked"])
  }
  return err.message?.trim() || fallback
}

async function resolveAdminContext(): Promise<
  | {
      ok: true
      facilityId: string
      employeeId: string | null
    }
  | { ok: false; error: string }
> {
  await requireAdmin()
  const current = await getCurrentUser()
  const profile = current?.profile
  if (!profile) return { ok: false, error: "Not signed in." }
  const facilityId = profile.facility_id ?? null
  if (!facilityId) {
    return { ok: false, error: "No facility assigned to your account." }
  }

  const supabase = await createClient()
  const { data: emp } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", profile.id)
    .eq("facility_id", facilityId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{ id: string }>()

  return { ok: true, facilityId, employeeId: emp?.id ?? null }
}

function revalidateGovernance(): void {
  revalidatePath("/admin/scheduling")
  revalidatePath("/admin/scheduling/time-off")
  revalidatePath("/admin/scheduling/swaps")
  revalidatePath("/admin/scheduling/compliance")
  revalidatePath("/admin/scheduling/settings")
  revalidatePath("/admin/scheduling/notifications")
}

// ---------------------------------------------------------------------------
// Time-off actions
// ---------------------------------------------------------------------------

export async function decideTimeOffRequest(
  id: string,
  decision: "approved" | "denied",
  note?: string
): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    if (!id) return { ok: false, error: "Missing request id." }

    const supabase = await createClient()
    const { data: existing, error: selErr } = await supabase
      .from("schedule_time_off_requests")
      .select("id, employee_id, facility_id, status")
      .eq("id", id)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle<{
        id: string
        employee_id: string
        facility_id: string
        status: string
      }>()
    if (selErr) {
      return { ok: false, error: dbError(selErr, "Failed to load request.") }
    }
    if (!existing) {
      return { ok: false, error: "Request not found." }
    }
    if (existing.status !== "pending") {
      return { ok: false, error: "Only pending requests can be decided." }
    }

    const nowIso = new Date().toISOString()
    const { error: updErr } = await supabase
      .from("schedule_time_off_requests")
      .update({
        status: decision,
        approved_by_employee_id: ctx.employeeId,
        decided_at: nowIso,
        decision_note: note?.trim() ? note.trim() : null,
      })
      .eq("id", id)
      .eq("facility_id", ctx.facilityId)
    if (updErr) {
      return { ok: false, error: dbError(updErr, "Failed to update request.") }
    }

    await supabase.from("schedule_notifications").insert({
      facility_id: ctx.facilityId,
      employee_id: existing.employee_id,
      notification_type: "time_off_decided",
      time_off_id: id,
      payload: {
        decision,
        decision_note: note?.trim() ? note.trim() : null,
      },
    })

    revalidateGovernance()
    return {
      ok: true,
      message:
        decision === "approved" ? "Request approved." : "Request denied.",
    }
  } catch (e) {
    logServerError("admin/scheduling/_lib/governance-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function cancelTimeOffRequest(id: string): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    if (!id) return { ok: false, error: "Missing request id." }

    const supabase = await createClient()
    const { error } = await supabase
      .from("schedule_time_off_requests")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("facility_id", ctx.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to cancel request.") }
    }
    revalidateGovernance()
    return { ok: true, message: "Request cancelled." }
  } catch (e) {
    logServerError("admin/scheduling/_lib/governance-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// ---------------------------------------------------------------------------
// Swap actions
// ---------------------------------------------------------------------------

type SwapRow = {
  id: string
  facility_id: string
  status: string
  requester_employee_id: string
  requester_shift_id: string
  target_employee_id: string | null
  target_shift_id: string | null
}

async function loadSwap(
  id: string,
  facilityId: string
): Promise<{ ok: true; row: SwapRow } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("schedule_swap_requests")
    .select(
      "id, facility_id, status, requester_employee_id, requester_shift_id, target_employee_id, target_shift_id"
    )
    .eq("id", id)
    .eq("facility_id", facilityId)
    .maybeSingle<SwapRow>()
  if (error) {
    return { ok: false, error: dbError(error, "Failed to load swap.") }
  }
  if (!data) return { ok: false, error: "Swap request not found." }
  return { ok: true, row: data }
}

export async function assignSwapTarget(
  id: string,
  targetEmployeeId: string
): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    if (!id) return { ok: false, error: "Missing swap id." }
    if (!targetEmployeeId) {
      return { ok: false, error: "Pick an employee to assign." }
    }

    const swap = await loadSwap(id, ctx.facilityId)
    if (!swap.ok) return swap
    if (swap.row.status !== "pending") {
      return {
        ok: false,
        error: "Targets can only be assigned to pending swaps.",
      }
    }
    if (swap.row.requester_employee_id === targetEmployeeId) {
      return {
        ok: false,
        error: "Target must differ from the requester.",
      }
    }

    const supabase = await createClient()

    // The target id comes from the client — verify it names an active
    // employee of THIS facility before writing it onto the swap.
    const { data: targetEmp } = await supabase
      .from("employees")
      .select("id")
      .eq("id", targetEmployeeId)
      .eq("facility_id", ctx.facilityId)
      .eq("is_active", true)
      .maybeSingle()
    if (!targetEmp) {
      return {
        ok: false,
        error: "That employee isn't an active member of your facility.",
      }
    }

    const { error } = await supabase
      .from("schedule_swap_requests")
      .update({
        target_employee_id: targetEmployeeId,
        status: "accepted",
        accepted_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("facility_id", ctx.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to assign target.") }
    }

    // Best-effort heads-up to the assigned employee.
    await supabase.from("schedule_notifications").insert({
      facility_id: ctx.facilityId,
      employee_id: targetEmployeeId,
      notification_type: "swap_request_received",
      swap_id: id,
      payload: {
        message:
          "A manager assigned you to cover a coworker's shift — pending final approval.",
      },
    })

    revalidateGovernance()
    return { ok: true, message: "Target assigned." }
  } catch (e) {
    logServerError("admin/scheduling/_lib/governance-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

type ApplySwapRpcResult = {
  ok?: boolean
  error?: string
  violations?: string[]
}

export async function approveSwap(
  id: string,
  note?: string
): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    if (!id) return { ok: false, error: "Missing swap id." }

    // The RPC re-runs every check inside one transaction: it locks the swap
    // and both shifts, verifies neither shift was reassigned since the swap
    // was filed, validates both directions while excluding BOTH traded shifts
    // (so the counterpart can't false-positive double-booking / weekly-hours
    // / min-rest), applies the exchange — or a one-way coverage hand-off when
    // there is no counter-shift — and notifies both employees.
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("scheduling_apply_swap", {
      p_swap_id: id,
      p_decision_note: note?.trim() ? note.trim() : undefined,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to approve swap.") }
    }

    const result = (data ?? {}) as ApplySwapRpcResult
    if (result.ok !== true) {
      const who =
        result.error === "target_not_assignable"
          ? "The target employee can't take the requester's shift: "
          : result.error === "requester_not_assignable"
            ? "The requester can't take the target's shift: "
            : ""
      const detail =
        result.violations && result.violations.length > 0
          ? formatViolations(result.violations)
          : (result.error ?? "Failed to approve swap.")
      return { ok: false, error: who ? `${who}${detail}` : detail }
    }

    revalidateGovernance()
    return { ok: true, message: "Swap approved and applied." }
  } catch (e) {
    logServerError("admin/scheduling/_lib/governance-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function denySwap(
  id: string,
  note?: string
): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    if (!id) return { ok: false, error: "Missing swap id." }

    const swap = await loadSwap(id, ctx.facilityId)
    if (!swap.ok) return swap
    if (swap.row.status === "denied" || swap.row.status === "cancelled") {
      return { ok: false, error: "Swap already in terminal state." }
    }
    if (swap.row.status === "manager_approved") {
      return { ok: false, error: "Cannot deny a swap that's already applied." }
    }

    const supabase = await createClient()
    const nowIso = new Date().toISOString()
    const { error } = await supabase
      .from("schedule_swap_requests")
      .update({
        status: "denied",
        decision_note: note?.trim() ? note.trim() : null,
        decided_at: nowIso,
        manager_approver_employee_id: ctx.employeeId,
      })
      .eq("id", id)
      .eq("facility_id", ctx.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to deny swap.") }
    }

    // Notify the requester — and the target too, if one had accepted.
    const denialRecipients = [
      swap.row.requester_employee_id,
      ...(swap.row.target_employee_id ? [swap.row.target_employee_id] : []),
    ]
    await supabase.from("schedule_notifications").insert(
      denialRecipients.map((employeeId) => ({
        facility_id: ctx.facilityId,
        employee_id: employeeId,
        notification_type: "swap_denied" as const,
        swap_id: id,
        payload: { decision_note: note?.trim() ? note.trim() : null },
      }))
    )

    revalidateGovernance()
    return { ok: true, message: "Swap denied." }
  } catch (e) {
    logServerError("admin/scheduling/_lib/governance-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function cancelSwap(id: string): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    if (!id) return { ok: false, error: "Missing swap id." }

    const swap = await loadSwap(id, ctx.facilityId)
    if (!swap.ok) return swap
    if (swap.row.status === "manager_approved") {
      return { ok: false, error: "Cannot cancel an applied swap." }
    }

    const supabase = await createClient()
    const { error } = await supabase
      .from("schedule_swap_requests")
      .update({
        status: "cancelled",
        decided_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("facility_id", ctx.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to cancel swap.") }
    }
    revalidateGovernance()
    return { ok: true, message: "Swap cancelled." }
  } catch (e) {
    logServerError("admin/scheduling/_lib/governance-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// ---------------------------------------------------------------------------
// Compliance rules
// ---------------------------------------------------------------------------

function isJsonObject(v: Json | null | undefined): v is { [k: string]: Json } {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

export async function createComplianceRule(
  input: CreateComplianceRuleInput
): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    if (!input.name?.trim()) {
      return { ok: false, error: "Name is required." }
    }
    if (!isComplianceRuleType(input.rule_type)) {
      return { ok: false, error: "Unknown rule type." }
    }

    const supabase = await createClient()
    const { error } = await supabase.from("schedule_compliance_rules").insert({
      facility_id: ctx.facilityId,
      rule_type: input.rule_type,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      params: input.params as Json,
      is_active: input.is_active ?? true,
      sort_order: input.sort_order ?? 0,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to create rule.") }
    }
    revalidateGovernance()
    return { ok: true, message: "Rule created." }
  } catch (e) {
    logServerError("admin/scheduling/_lib/governance-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function updateComplianceRule(
  id: string,
  patch: UpdateComplianceRulePatch
): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    if (!id) return { ok: false, error: "Missing rule id." }

    const supabase = await createClient()
    const { data: current, error: selErr } = await supabase
      .from("schedule_compliance_rules")
      .select("id, params, facility_id")
      .eq("id", id)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle<{ id: string; params: Json; facility_id: string }>()
    if (selErr) {
      return { ok: false, error: dbError(selErr, "Failed to load rule.") }
    }
    if (!current) return { ok: false, error: "Rule not found." }

    const update: {
      name?: string
      description?: string | null
      is_active?: boolean
      sort_order?: number | null
      params?: Json
    } = {}
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim()
      if (!trimmed) return { ok: false, error: "Name cannot be empty." }
      update.name = trimmed
    }
    if (patch.description !== undefined) {
      update.description = patch.description?.trim() || null
    }
    if (patch.is_active !== undefined) {
      update.is_active = patch.is_active
    }
    if (patch.sort_order !== undefined) {
      update.sort_order = patch.sort_order
    }
    if (patch.params_replace !== undefined) {
      update.params = patch.params_replace as Json
    } else if (patch.params_patch !== undefined) {
      const base = isJsonObject(current.params) ? current.params : {}
      update.params = { ...base, ...patch.params_patch } as Json
    }

    if (Object.keys(update).length === 0) {
      return { ok: true, message: "Nothing to update." }
    }

    const { error: updErr } = await supabase
      .from("schedule_compliance_rules")
      .update(update)
      .eq("id", id)
      .eq("facility_id", ctx.facilityId)
    if (updErr) {
      return { ok: false, error: dbError(updErr, "Failed to update rule.") }
    }
    revalidateGovernance()
    return { ok: true, message: "Rule updated." }
  } catch (e) {
    logServerError("admin/scheduling/_lib/governance-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function setComplianceRuleActive(
  id: string,
  isActive: boolean
): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    if (!id) return { ok: false, error: "Missing rule id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("schedule_compliance_rules")
      .update({ is_active: isActive })
      .eq("id", id)
      .eq("facility_id", ctx.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update rule.") }
    }
    revalidateGovernance()
    return { ok: true, message: isActive ? "Rule enabled." : "Rule disabled." }
  } catch (e) {
    logServerError("admin/scheduling/_lib/governance-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteComplianceRule(id: string): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    if (!id) return { ok: false, error: "Missing rule id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("schedule_compliance_rules")
      .delete()
      .eq("id", id)
      .eq("facility_id", ctx.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to delete rule.") }
    }
    revalidateGovernance()
    return { ok: true, message: "Rule deleted." }
  } catch (e) {
    logServerError("admin/scheduling/_lib/governance-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function moveComplianceRule(
  id: string,
  delta: 1 | -1
): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    if (!id) return { ok: false, error: "Missing rule id." }

    const supabase = await createClient()
    const { data: rules, error: selErr } = await supabase
      .from("schedule_compliance_rules")
      .select("id, sort_order")
      .eq("facility_id", ctx.facilityId)
      .order("sort_order", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
    if (selErr) {
      return { ok: false, error: dbError(selErr, "Failed to load rules.") }
    }
    const list = (rules ?? []) as Array<{
      id: string
      sort_order: number | null
    }>
    const idx = list.findIndex((r) => r.id === id)
    if (idx < 0) return { ok: false, error: "Rule not found." }
    const swapIdx = idx + delta
    if (swapIdx < 0 || swapIdx >= list.length) {
      return { ok: false, error: "Cannot move further." }
    }
    const a = list[idx]
    const b = list[swapIdx]
    const aOrder = a.sort_order ?? idx
    const bOrder = b.sort_order ?? swapIdx

    // Two-phase swap to dodge any unique-on-sort_order constraints.
    const tmp = -1 - idx
    const r1 = await supabase
      .from("schedule_compliance_rules")
      .update({ sort_order: tmp })
      .eq("id", a.id)
      .eq("facility_id", ctx.facilityId)
    if (r1.error) {
      return { ok: false, error: dbError(r1.error, "Failed to reorder.") }
    }
    const r2 = await supabase
      .from("schedule_compliance_rules")
      .update({ sort_order: aOrder })
      .eq("id", b.id)
      .eq("facility_id", ctx.facilityId)
    if (r2.error) {
      return { ok: false, error: dbError(r2.error, "Failed to reorder.") }
    }
    const r3 = await supabase
      .from("schedule_compliance_rules")
      .update({ sort_order: bOrder })
      .eq("id", a.id)
      .eq("facility_id", ctx.facilityId)
    if (r3.error) {
      return { ok: false, error: dbError(r3.error, "Failed to reorder.") }
    }
    revalidateGovernance()
    return { ok: true, message: "Order updated." }
  } catch (e) {
    logServerError("admin/scheduling/_lib/governance-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function updateSchedulingSettings(
  values: SchedulingSettingsInput
): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const wsd = Number(values.week_start_day)
    if (!Number.isInteger(wsd) || wsd < 0 || wsd > 6) {
      return { ok: false, error: "Week start day must be 0..6." }
    }
    const dsm = Number(values.default_shift_minutes)
    if (!Number.isFinite(dsm) || dsm <= 0) {
      return { ok: false, error: "Default shift minutes must be positive." }
    }
    const seh = Number(values.swap_expiry_hours)
    if (!Number.isInteger(seh) || seh <= 0) {
      return {
        ok: false,
        error: "Swap expiry hours must be a positive whole number.",
      }
    }

    const supabase = await createClient()
    const { error } = await supabase
      .from("schedule_settings")
      .upsert(
        {
          facility_id: ctx.facilityId,
          week_start_day: wsd,
          default_shift_minutes: dsm,
          minor_max_weekly_hours: values.minor_max_weekly_hours,
          overtime_weekly_hours: values.overtime_weekly_hours,
          minimum_break_minutes: values.minimum_break_minutes,
          minimum_break_after_hours: values.minimum_break_after_hours,
          swap_requires_manager_approval: values.swap_requires_manager_approval,
          swap_expiry_hours: seh,
          open_shift_first_come: values.open_shift_first_come,
          notify_on_publish: values.notify_on_publish,
          notify_on_overtime: values.notify_on_overtime,
          availability_submission_enabled: values.availability_submission_enabled,
          require_job_area_qualification: values.require_job_area_qualification,
          block_on_violations: values.block_on_violations,
        },
        { onConflict: "facility_id" }
      )
    if (error) {
      return { ok: false, error: dbError(error, "Failed to save settings.") }
    }
    revalidateGovernance()
    return { ok: true, message: "Settings saved." }
  } catch (e) {
    logServerError("admin/scheduling/_lib/governance-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function seedSchedulingDefaults(): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    const supabase = await createClient()

    const { error: settingsErr } = await supabase
      .from("schedule_settings")
      .upsert(
        {
          facility_id: ctx.facilityId,
          week_start_day: 0,
          default_shift_minutes: 480,
          minor_max_weekly_hours: 18,
          overtime_weekly_hours: 40,
          minimum_break_minutes: 30,
          minimum_break_after_hours: 6,
          swap_requires_manager_approval: true,
          open_shift_first_come: true,
          notify_on_publish: true,
          notify_on_overtime: true,
          availability_submission_enabled: true,
          require_job_area_qualification: false,
          block_on_violations: false,
        },
        { onConflict: "facility_id" }
      )
    if (settingsErr) {
      return {
        ok: false,
        error: dbError(settingsErr, "Failed to seed settings."),
      }
    }

    // Only seed compliance rules if none exist yet for this facility.
    const { data: existing, error: cntErr } = await supabase
      .from("schedule_compliance_rules")
      .select("id")
      .eq("facility_id", ctx.facilityId)
      .limit(1)
    if (cntErr) {
      return { ok: false, error: dbError(cntErr, "Failed to read rules.") }
    }

    if ((existing ?? []).length === 0) {
      const { error: insErr } = await supabase
        .from("schedule_compliance_rules")
        .insert([
          {
            facility_id: ctx.facilityId,
            rule_type: "minor_max_hours",
            name: "Minor max weekly hours",
            description: "Cap weekly hours for minors.",
            params: {
              max_weekly_hours: 18,
              applies_to_minors: true,
            } as Json,
            is_active: true,
            sort_order: 0,
          },
          {
            facility_id: ctx.facilityId,
            rule_type: "overtime",
            name: "Overtime threshold",
            description: "Warn when weekly hours cross threshold.",
            params: { weekly_threshold: 40 } as Json,
            is_active: true,
            sort_order: 1,
          },
          {
            facility_id: ctx.facilityId,
            rule_type: "break_required",
            name: "Required break",
            description: "Require a break for long shifts.",
            params: { after_hours: 6, min_minutes: 30 } as Json,
            is_active: true,
            sort_order: 2,
          },
        ])
      if (insErr) {
        return {
          ok: false,
          error: dbError(insErr, "Failed to seed compliance rules."),
        }
      }
    }

    revalidateGovernance()
    return { ok: true, message: "Defaults seeded." }
  } catch (e) {
    logServerError("admin/scheduling/_lib/governance-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}
