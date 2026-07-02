"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/observability/log-server-error"
import { addDaysToKey, wallTimeToUtc, weekdayOfKey } from "@/lib/timezone"

import { formatViolations } from "./enforcement"
import { formatShiftWindow, queueSchedulingEmails } from "./notify-email"
import { sendDueShiftReminders } from "./shift-reminders"
import type {
  ActionState,
  CreateTemplateInput,
  CreateTemplateShiftInput,
} from "./types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------



type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  if (err.code === "23505") {
    return "That value conflicts with an existing record (duplicate)."
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

// ---------------------------------------------------------------------------
// Form parsing (server actions accept FormData)
// ---------------------------------------------------------------------------

function nonEmpty(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null
  const t = value.trim()
  return t.length === 0 ? null : t
}

function parseInt0(value: FormDataEntryValue | null): number | null {
  const s = nonEmpty(value)
  if (!s) return null
  const n = Number.parseInt(s, 10)
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// Shift actions
// ---------------------------------------------------------------------------
//
// NOTE: direct create/update/delete of individual shifts is owned by the
// scheduling grid (`./grid-actions.ts`), which routes published-shift mutations
// through the audited `scheduling_admin_edit_published_shift` /
// `scheduling_admin_cancel_shift` SECURITY DEFINER RPCs (respecting the
// migration-148 publish lock). The legacy `createShift` / `updateShift` /
// `deleteShift` form actions that used to live here were unwired and bypassed
// that routing, so they were removed. The open-shift assignment / claim / cancel
// actions below remain in use by the hub UI.

type AdminAssignOpenRpcResult = {
  ok?: boolean
  error?: string
  violations?: string[]
}

export async function assignOpenShift(
  openShiftId: string,
  employeeId: string
): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    if (!openShiftId) return { ok: false, error: "Missing open shift id." }
    if (!employeeId) return { ok: false, error: "Pick an employee." }

    // The open shift's parent is a PUBLISHED row, so the publish-lock rejects a
    // direct UPDATE from this server action. Route the fill through the
    // SECURITY DEFINER RPC, which locks the listing + shift, re-validates the
    // assignment as a hard block, fills the still-unassigned slot, and closes
    // out the listing — all in one transaction.
    const supabase = await createClient()
    const { data, error } = await supabase.rpc(
      "scheduling_admin_assign_open_shift",
      { p_open_shift_id: openShiftId, p_employee_id: employeeId }
    )
    if (error) {
      return { ok: false, error: dbError(error, "Failed to assign shift.") }
    }
    const result = (data ?? {}) as AdminAssignOpenRpcResult
    if (result.ok !== true) {
      const detail =
        result.error === "not_assignable" && result.violations?.length
          ? formatViolations(result.violations)
          : (result.error ?? "Failed to assign shift.")
      return { ok: false, error: detail }
    }

    revalidatePath("/admin/scheduling/shifts")
    revalidatePath("/admin/scheduling")
    return { ok: true, message: "Open shift assigned." }
  } catch (e) {
    logServerError("admin/scheduling/_lib/admin-core-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

type DecideOpenClaimRpcResult = {
  ok?: boolean
  decision?: string
  error?: string
  violations?: string[]
}

/**
 * Approve or decline a pending approval-required claim on an open shift.
 * The RPC is atomic: it locks the listing + parent shift, re-validates the
 * claimant on approve, assigns the still-unassigned shift, and notifies the
 * claimant either way.
 */
export async function decideOpenShiftClaim(
  openShiftId: string,
  approve: boolean,
  note?: string
): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    if (!openShiftId) return { ok: false, error: "Missing open shift id." }

    const supabase = await createClient()
    const { data, error } = await supabase.rpc("scheduling_decide_open_claim", {
      p_open_shift_id: openShiftId,
      p_approve: approve,
      p_note: note?.trim() ? note.trim() : undefined,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to decide claim.") }
    }
    const result = (data ?? {}) as DecideOpenClaimRpcResult
    if (result.ok !== true) {
      const detail =
        result.violations && result.violations.length > 0
          ? `The claimant can no longer work this shift: ${formatViolations(result.violations)}`
          : (result.error ?? "Failed to decide claim.")
      return { ok: false, error: detail }
    }

    revalidatePath("/admin/scheduling")
    revalidatePath("/admin/scheduling/shifts")
    return {
      ok: true,
      message:
        result.decision === "approved"
          ? "Claim approved — shift assigned."
          : "Claim declined — shift reopened.",
    }
  } catch (e) {
    logServerError("admin/scheduling/_lib/admin-core-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function cancelShift(id: string): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    if (!id) return { ok: false, error: "Missing shift id." }
    const supabase = await createClient()
    // Read the assignment before cancelling so the email can name the window.
    const { data: cur } = await supabase
      .from("schedule_shifts")
      .select("employee_id, starts_at, ends_at")
      .eq("id", id)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle<{
        employee_id: string | null
        starts_at: string
        ends_at: string
      }>()
    // Cancelling a PUBLISHED shift is a governed status transition; the
    // publish-lock rejects a direct UPDATE, so go through the SECURITY DEFINER
    // RPC (also works for drafts).
    const { data, error } = await supabase.rpc("scheduling_admin_cancel_shift", {
      p_shift_id: id,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to cancel shift.") }
    }
    const result = (data ?? {}) as { ok?: boolean; error?: string }
    if (result.ok !== true) {
      return { ok: false, error: result.error ?? "Failed to cancel shift." }
    }
    // The RPC wrote the in-app notification; add the best-effort email.
    if (cur?.employee_id) {
      await queueSchedulingEmails([
        {
          facilityId: ctx.facilityId,
          employeeId: cur.employee_id,
          subject: "Your shift was cancelled",
          body: `Your shift on ${formatShiftWindow(cur.starts_at, cur.ends_at)} was cancelled by a manager.`,
          sourceRecordId: id,
        },
      ])
    }
    revalidatePath("/admin/scheduling/shifts")
    revalidatePath("/admin/scheduling")
    return { ok: true, message: "Shift cancelled." }
  } catch (e) {
    logServerError("admin/scheduling/_lib/admin-core-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function parseTemplateInput(
  formData: FormData
): { ok: true; value: CreateTemplateInput } | { ok: false; error: string } {
  const name = nonEmpty(formData.get("name"))
  if (!name) return { ok: false, error: "Name is required." }
  const slug = nonEmpty(formData.get("slug"))
  if (!slug) return { ok: false, error: "Slug is required." }
  const description = nonEmpty(formData.get("description"))
  const is_active = formData.get("is_active") === "on"
  return { ok: true, value: { name, slug, description, is_active } }
}

export async function createTemplate(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    const parsed = parseTemplateInput(formData)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const input = parsed.value
    const supabase = await createClient()
    const { error } = await supabase.from("schedule_templates").insert({
      facility_id: ctx.facilityId,
      name: input.name,
      slug: input.slug,
      description: input.description,
      is_active: input.is_active,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to create template.") }
    }
    revalidatePath("/admin/scheduling/templates")
    return { ok: true, message: "Template created." }
  } catch (e) {
    logServerError("admin/scheduling/_lib/admin-core-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function updateTemplate(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing template id." }
    const parsed = parseTemplateInput(formData)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const input = parsed.value
    const supabase = await createClient()
    const { error } = await supabase
      .from("schedule_templates")
      .update({
        name: input.name,
        slug: input.slug,
        description: input.description,
        is_active: input.is_active,
      })
      .eq("id", id)
      .eq("facility_id", ctx.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update template.") }
    }
    revalidatePath("/admin/scheduling/templates")
    return { ok: true, message: "Template updated." }
  } catch (e) {
    logServerError("admin/scheduling/_lib/admin-core-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function setTemplateActive(
  id: string,
  isActive: boolean
): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    if (!id) return { ok: false, error: "Missing template id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("schedule_templates")
      .update({ is_active: isActive })
      .eq("id", id)
      .eq("facility_id", ctx.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update template.") }
    }
    revalidatePath("/admin/scheduling/templates")
    return { ok: true }
  } catch (e) {
    logServerError("admin/scheduling/_lib/admin-core-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteTemplate(id: string): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    if (!id) return { ok: false, error: "Missing template id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("schedule_templates")
      .delete()
      .eq("id", id)
      .eq("facility_id", ctx.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to delete template.") }
    }
    revalidatePath("/admin/scheduling/templates")
    return { ok: true, message: "Template deleted." }
  } catch (e) {
    logServerError("admin/scheduling/_lib/admin-core-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

function parseTemplateShiftInput(
  formData: FormData
):
  | { ok: true; value: CreateTemplateShiftInput }
  | { ok: false; error: string } {
  const template_id = nonEmpty(formData.get("template_id"))
  if (!template_id) return { ok: false, error: "Template is required." }
  const department_id = nonEmpty(formData.get("department_id"))
  if (!department_id) return { ok: false, error: "Department is required." }
  const dowRaw = parseInt0(formData.get("day_of_week"))
  if (dowRaw === null || dowRaw < 0 || dowRaw > 6) {
    return { ok: false, error: "Day of week is required." }
  }
  const start_time = nonEmpty(formData.get("start_time"))
  if (!start_time) return { ok: false, error: "Start time is required." }
  const end_time = nonEmpty(formData.get("end_time"))
  if (!end_time) return { ok: false, error: "End time is required." }
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number)
    return h * 60 + m
  }
  if (toMinutes(end_time) <= toMinutes(start_time)) {
    return { ok: false, error: "End must be after start." }
  }
  const staff_count = parseInt0(formData.get("staff_count")) ?? 1
  return {
    ok: true,
    value: {
      template_id,
      department_id,
      job_area_id: nonEmpty(formData.get("job_area_id")),
      day_of_week: dowRaw,
      start_time,
      end_time,
      break_minutes: Math.max(0, parseInt0(formData.get("break_minutes")) ?? 0),
      role_label: nonEmpty(formData.get("role_label")),
      staff_count: Math.max(1, staff_count),
    },
  }
}

export async function createTemplateShift(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    const parsed = parseTemplateShiftInput(formData)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const input = parsed.value
    const supabase = await createClient()
    const { error } = await supabase.from("schedule_template_shifts").insert({
      facility_id: ctx.facilityId,
      template_id: input.template_id,
      department_id: input.department_id,
      job_area_id: input.job_area_id,
      day_of_week: input.day_of_week,
      start_time: input.start_time,
      end_time: input.end_time,
      break_minutes: input.break_minutes ?? 0,
      role_label: input.role_label,
      staff_count: input.staff_count,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to add slot.") }
    }
    revalidatePath("/admin/scheduling/templates")
    return { ok: true, message: "Slot added." }
  } catch (e) {
    logServerError("admin/scheduling/_lib/admin-core-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function updateTemplateShift(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing slot id." }
    const parsed = parseTemplateShiftInput(formData)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const input = parsed.value
    const supabase = await createClient()
    const { error } = await supabase
      .from("schedule_template_shifts")
      .update({
        department_id: input.department_id,
        job_area_id: input.job_area_id,
        day_of_week: input.day_of_week,
        start_time: input.start_time,
        end_time: input.end_time,
        break_minutes: input.break_minutes ?? 0,
        role_label: input.role_label,
        staff_count: input.staff_count,
      })
      .eq("id", id)
      .eq("facility_id", ctx.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update slot.") }
    }
    revalidatePath("/admin/scheduling/templates")
    return { ok: true, message: "Slot updated." }
  } catch (e) {
    logServerError("admin/scheduling/_lib/admin-core-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteTemplateShift(id: string): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    if (!id) return { ok: false, error: "Missing slot id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("schedule_template_shifts")
      .delete()
      .eq("id", id)
      .eq("facility_id", ctx.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to delete slot.") }
    }
    revalidatePath("/admin/scheduling/templates")
    return { ok: true, message: "Slot deleted." }
  } catch (e) {
    logServerError("admin/scheduling/_lib/admin-core-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// ---------------------------------------------------------------------------
// Apply template to week
// ---------------------------------------------------------------------------

function combineDateAndTime(
  weekStartKey: string,
  dayOffset: number,
  time: string,
  timezone: string | null
): string | null {
  // time is HH:MM or HH:MM:SS — a wall-clock time in the FACILITY's timezone.
  const dateKey = addDaysToKey(weekStartKey, dayOffset)
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time)
  const wall = m
    ? `${dateKey}T${m[1]}:${m[2]}:${m[3] ?? "00"}`
    : `${dateKey}T00:00:00`
  return wallTimeToUtc(wall, timezone)?.toISOString() ?? null
}

export async function applyTemplateToWeek(
  templateId: string,
  weekStart: string
): Promise<ActionState & { count?: number }> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    if (!templateId) return { ok: false, error: "Template required." }
    if (!weekStart) return { ok: false, error: "Week start required." }

    const ws = new Date(weekStart)
    if (Number.isNaN(ws.getTime())) {
      return { ok: false, error: "Invalid week start." }
    }
    const pickedKey = /^\d{4}-\d{2}-\d{2}$/.test(weekStart)
      ? weekStart
      : ws.toISOString().slice(0, 10)

    const supabase = await createClient()

    // Template times are wall-clock in the facility's timezone; slot days are
    // laid out from the facility's configured week start.
    const [{ data: facilityRow }, { data: settingsRow }] = await Promise.all([
      supabase
        .from("facilities")
        .select("timezone")
        .eq("id", ctx.facilityId)
        .maybeSingle<{ timezone: string | null }>(),
      supabase
        .from("schedule_settings")
        .select("week_start_day")
        .eq("facility_id", ctx.facilityId)
        .maybeSingle<{ week_start_day: number }>(),
    ])
    const timezone = facilityRow?.timezone ?? null
    const weekStartDay = (((settingsRow?.week_start_day ?? 0) % 7) + 7) % 7

    // Snap any picked date back to the week's configured start day, so the
    // template lands on the week containing that date regardless of which
    // day the admin clicked.
    const weekStartKey = addDaysToKey(
      pickedKey,
      -((weekdayOfKey(pickedKey) - weekStartDay + 7) % 7)
    )

    const { data: slotsRaw, error: selErr } = await supabase
      .from("schedule_template_shifts")
      .select(
        "id, department_id, job_area_id, day_of_week, start_time, end_time, break_minutes, role_label, staff_count"
      )
      .eq("template_id", templateId)
      .eq("facility_id", ctx.facilityId)

    if (selErr) {
      return { ok: false, error: dbError(selErr, "Failed to load template.") }
    }

    const slots = (slotsRaw ?? []) as Array<{
      id: string
      department_id: string
      job_area_id: string | null
      day_of_week: number
      start_time: string
      end_time: string
      break_minutes: number | null
      role_label: string | null
      staff_count: number
    }>

    if (slots.length === 0) {
      return { ok: false, error: "Template has no slots." }
    }

    const rows: Array<{
      facility_id: string
      department_id: string
      job_area_id: string | null
      employee_id: null
      starts_at: string
      ends_at: string
      break_minutes: number
      role_label: string | null
      status: "draft"
      template_origin_id: string
      compliance_warnings: string[]
    }> = []
    for (const slot of slots) {
      // Slot day_of_week is 0=Sunday-based; the offset from the (possibly
      // non-Sunday) week start places it on the right calendar day.
      const dayOffset = (slot.day_of_week - weekStartDay + 7) % 7
      const starts_at = combineDateAndTime(
        weekStartKey,
        dayOffset,
        slot.start_time,
        timezone
      )
      const ends_at = combineDateAndTime(
        weekStartKey,
        dayOffset,
        slot.end_time,
        timezone
      )
      if (!starts_at || !ends_at) {
        return { ok: false, error: "Template slot has an invalid time." }
      }
      for (let i = 0; i < slot.staff_count; i++) {
        rows.push({
          facility_id: ctx.facilityId,
          department_id: slot.department_id,
          job_area_id: slot.job_area_id,
          employee_id: null,
          starts_at,
          ends_at,
          break_minutes: slot.break_minutes ?? 0,
          role_label: slot.role_label,
          status: "draft",
          template_origin_id: templateId,
          compliance_warnings: [],
        })
      }
    }

    const { error: insErr } = await supabase
      .from("schedule_shifts")
      .insert(rows)
    if (insErr) {
      return { ok: false, error: dbError(insErr, "Failed to apply template.") }
    }

    revalidatePath("/admin/scheduling/shifts")
    revalidatePath("/admin/scheduling")
    return {
      ok: true,
      message: `Created ${rows.length} draft shift${rows.length === 1 ? "" : "s"} for the week of ${weekStartKey}.`,
      count: rows.length,
    }
  } catch (e) {
    logServerError("admin/scheduling/_lib/admin-core-actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// ---------------------------------------------------------------------------
// sendShiftReminders
// ---------------------------------------------------------------------------

export async function sendShiftReminders(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState & { count?: number }> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const hoursRaw = Number(formData.get("hours") ?? 24)

    // Shared sweep (same logic the scheduling cron runs automatically),
    // scoped to this facility via the RLS client.
    const supabase = await createClient()
    const result = await sendDueShiftReminders(supabase, {
      facilityId: ctx.facilityId,
      windowHours: hoursRaw,
    })
    if (!result.ok) return { ok: false, error: result.error }

    revalidatePath("/admin/scheduling/notifications")
    return {
      ok: true,
      message:
        result.sent === 0
          ? "No shifts in this window need a reminder."
          : `${result.sent} reminder${result.sent === 1 ? "" : "s"} sent.`,
      count: result.sent,
    }
  } catch (e) {
    logServerError("admin/scheduling/_lib/admin-core-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}
