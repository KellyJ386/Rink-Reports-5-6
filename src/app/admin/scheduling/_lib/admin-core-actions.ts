"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import type {
  ActionState,
  CreateShiftInput,
  CreateTemplateInput,
  CreateTemplateShiftInput,
  ShiftStatus,
  UpdateShiftInput,
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

function startOfWeekUTC(date: string): Date {
  // Sunday-anchored week (matches default settings.week_start_day = 0).
  // For compliance hour summing we just need a window per shift; using Sun-Sat.
  const d = new Date(date)
  const day = d.getUTCDay()
  const start = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  )
  start.setUTCDate(start.getUTCDate() - day)
  return start
}

// ---------------------------------------------------------------------------
// Compliance computation (stub per spec)
// ---------------------------------------------------------------------------

type SettingsForCompliance = {
  minor_max_weekly_hours: number | null
  overtime_weekly_hours: number | null
}

type EmployeeForCompliance = {
  id: string
  is_minor: boolean
}

type ShiftForHours = {
  starts_at: string
  ends_at: string
  break_minutes: number | null
}

function shiftHours(s: ShiftForHours): number {
  const ms = new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()
  const minutes = Math.max(0, ms / 60000) - (s.break_minutes ?? 0)
  return Math.max(0, minutes / 60)
}

async function computeComplianceWarnings(
  shift: {
    starts_at: string
    ends_at: string
    break_minutes: number | null
    employee_id: string | null
  },
  settings: SettingsForCompliance | null,
  employee: EmployeeForCompliance | null,
  excludeShiftId: string | null
): Promise<string[]> {
  if (!shift.employee_id || !employee || !settings) return []

  const weekStart = startOfWeekUTC(shift.starts_at)
  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7)

  const supabase = await createClient()
  let query = supabase
    .from("schedule_shifts")
    .select("starts_at, ends_at, break_minutes")
    .eq("employee_id", shift.employee_id)
    .in("status", ["draft", "published"])
    .gte("starts_at", weekStart.toISOString())
    .lt("starts_at", weekEnd.toISOString())
  if (excludeShiftId) query = query.neq("id", excludeShiftId)

  const { data: existing } = await query
  const others = (existing ?? []) as ShiftForHours[]
  const totalHours =
    others.reduce((sum, s) => sum + shiftHours(s), 0) + shiftHours(shift)

  const warnings: string[] = []
  if (
    employee.is_minor &&
    settings.minor_max_weekly_hours != null &&
    totalHours > Number(settings.minor_max_weekly_hours)
  ) {
    warnings.push("minor_overtime")
  }
  if (
    settings.overtime_weekly_hours != null &&
    totalHours > Number(settings.overtime_weekly_hours)
  ) {
    warnings.push("overtime")
  }
  return warnings
}

async function loadComplianceContext(
  facilityId: string,
  employeeId: string | null
): Promise<{
  settings: SettingsForCompliance | null
  employee: EmployeeForCompliance | null
}> {
  const supabase = await createClient()
  const settingsRes = await supabase
    .from("schedule_settings")
    .select("minor_max_weekly_hours, overtime_weekly_hours")
    .eq("facility_id", facilityId)
    .maybeSingle<SettingsForCompliance>()

  let employee: EmployeeForCompliance | null = null
  if (employeeId) {
    const { data: emp } = await supabase
      .from("employees")
      .select("id, is_minor")
      .eq("id", employeeId)
      .maybeSingle<EmployeeForCompliance>()
    employee = emp ?? null
  }
  return { settings: settingsRes.data ?? null, employee }
}

// ---------------------------------------------------------------------------
// Shift form parsing (server actions accept FormData)
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

function parseStatus(value: FormDataEntryValue | null): ShiftStatus {
  const s = nonEmpty(value) ?? "draft"
  if (s === "published" || s === "cancelled") return s
  return "draft"
}

function isoFromLocal(value: FormDataEntryValue | null): string | null {
  const s = nonEmpty(value)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function parseShiftInput(
  formData: FormData
): { ok: true; value: CreateShiftInput } | { ok: false; error: string } {
  const department_id = nonEmpty(formData.get("department_id"))
  if (!department_id) return { ok: false, error: "Department is required." }

  const employeeRaw = nonEmpty(formData.get("employee_id"))
  const employee_id = employeeRaw === "__open__" ? null : employeeRaw

  const starts_at = isoFromLocal(formData.get("starts_at"))
  if (!starts_at) return { ok: false, error: "Start time is required." }
  const ends_at = isoFromLocal(formData.get("ends_at"))
  if (!ends_at) return { ok: false, error: "End time is required." }
  if (new Date(ends_at).getTime() <= new Date(starts_at).getTime()) {
    return { ok: false, error: "End must be after start." }
  }

  return {
    ok: true,
    value: {
      department_id,
      employee_id,
      starts_at,
      ends_at,
      break_minutes: Math.max(0, parseInt0(formData.get("break_minutes")) ?? 0),
      role_label: nonEmpty(formData.get("role_label")),
      notes: nonEmpty(formData.get("notes")),
      status: parseStatus(formData.get("status")),
    },
  }
}

// ---------------------------------------------------------------------------
// Shift actions
// ---------------------------------------------------------------------------

export async function createShift(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const parsed = parseShiftInput(formData)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const input = parsed.value

    const { settings, employee } = await loadComplianceContext(
      ctx.facilityId,
      input.employee_id
    )
    const warnings = await computeComplianceWarnings(
      input,
      settings,
      employee,
      null
    )

    const supabase = await createClient()
    const { error } = await supabase.from("schedule_shifts").insert({
      facility_id: ctx.facilityId,
      department_id: input.department_id,
      employee_id: input.employee_id,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      break_minutes: input.break_minutes ?? 0,
      role_label: input.role_label,
      notes: input.notes,
      status: input.status,
      compliance_warnings: warnings,
    })

    if (error) {
      return { ok: false, error: dbError(error, "Failed to create shift.") }
    }

    revalidatePath("/admin/scheduling/shifts")
    revalidatePath("/admin/scheduling")
    return { ok: true, message: "Shift created." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function updateShift(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing shift id." }

    const parsed = parseShiftInput(formData)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const input: UpdateShiftInput & CreateShiftInput = parsed.value

    const { settings, employee } = await loadComplianceContext(
      ctx.facilityId,
      input.employee_id
    )
    const warnings = await computeComplianceWarnings(
      input,
      settings,
      employee,
      id
    )

    const supabase = await createClient()
    const { error } = await supabase
      .from("schedule_shifts")
      .update({
        department_id: input.department_id,
        employee_id: input.employee_id,
        starts_at: input.starts_at,
        ends_at: input.ends_at,
        break_minutes: input.break_minutes ?? 0,
        role_label: input.role_label,
        notes: input.notes,
        status: input.status,
        compliance_warnings: warnings,
      })
      .eq("id", id)
      .eq("facility_id", ctx.facilityId)

    if (error) {
      return { ok: false, error: dbError(error, "Failed to update shift.") }
    }

    revalidatePath("/admin/scheduling/shifts")
    revalidatePath("/admin/scheduling")
    return { ok: true, message: "Shift updated." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteShift(id: string): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    if (!id) return { ok: false, error: "Missing shift id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("schedule_shifts")
      .delete()
      .eq("id", id)
      .eq("facility_id", ctx.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to delete shift.") }
    }
    revalidatePath("/admin/scheduling/shifts")
    revalidatePath("/admin/scheduling")
    return { ok: true, message: "Shift deleted." }
  } catch (e) {
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
    const { error } = await supabase
      .from("schedule_shifts")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("facility_id", ctx.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to cancel shift.") }
    }
    revalidatePath("/admin/scheduling/shifts")
    revalidatePath("/admin/scheduling")
    return { ok: true, message: "Shift cancelled." }
  } catch (e) {
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
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// ---------------------------------------------------------------------------
// Apply template to week
// ---------------------------------------------------------------------------

function combineDateAndTime(weekStartUtc: Date, dayOfWeek: number, time: string): string {
  // time is HH:MM or HH:MM:SS; treat as UTC wall time for v1 (per datetime.ts approach).
  const [hRaw, mRaw, sRaw] = time.split(":")
  const h = Number.parseInt(hRaw ?? "0", 10)
  const m = Number.parseInt(mRaw ?? "0", 10)
  const s = Number.parseInt(sRaw ?? "0", 10)
  const d = new Date(weekStartUtc)
  d.setUTCDate(d.getUTCDate() + dayOfWeek)
  d.setUTCHours(
    Number.isFinite(h) ? h : 0,
    Number.isFinite(m) ? m : 0,
    Number.isFinite(s) ? s : 0,
    0
  )
  return d.toISOString()
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
    const weekStartUtc = new Date(
      Date.UTC(ws.getUTCFullYear(), ws.getUTCMonth(), ws.getUTCDate())
    )

    const supabase = await createClient()
    const { data: slotsRaw, error: selErr } = await supabase
      .from("schedule_template_shifts")
      .select(
        "id, department_id, day_of_week, start_time, end_time, break_minutes, role_label, staff_count"
      )
      .eq("template_id", templateId)
      .eq("facility_id", ctx.facilityId)

    if (selErr) {
      return { ok: false, error: dbError(selErr, "Failed to load template.") }
    }

    const slots = (slotsRaw ?? []) as Array<{
      id: string
      department_id: string
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
      const starts_at = combineDateAndTime(
        weekStartUtc,
        slot.day_of_week,
        slot.start_time
      )
      const ends_at = combineDateAndTime(
        weekStartUtc,
        slot.day_of_week,
        slot.end_time
      )
      for (let i = 0; i < slot.staff_count; i++) {
        rows.push({
          facility_id: ctx.facilityId,
          department_id: slot.department_id,
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
      message: `Created ${rows.length} draft shift${rows.length === 1 ? "" : "s"}.`,
      count: rows.length,
    }
  } catch (e) {
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
    const hours = Number.isFinite(hoursRaw) && hoursRaw >= 1 ? Math.min(hoursRaw, 168) : 24

    const now = new Date()
    const cutoff = new Date(now.getTime() + hours * 60 * 60 * 1000)

    const supabase = await createClient()

    // Find published shifts starting in the window with assigned employees.
    const { data: shiftsRaw, error: shiftErr } = await supabase
      .from("schedule_shifts")
      .select("id, employee_id, starts_at, ends_at")
      .eq("facility_id", ctx.facilityId)
      .eq("status", "published")
      .not("employee_id", "is", null)
      .gte("starts_at", now.toISOString())
      .lte("starts_at", cutoff.toISOString())

    if (shiftErr) return { ok: false, error: dbError(shiftErr, "Failed to load shifts.") }

    const shifts = (shiftsRaw ?? []) as Array<{
      id: string
      employee_id: string
      starts_at: string
      ends_at: string
    }>

    if (shifts.length === 0) {
      return { ok: true, message: "No upcoming shifts found in that window.", count: 0 }
    }

    // Avoid duplicates: load existing shift_reminder notifications for these shifts.
    const shiftIds = shifts.map((s) => s.id)
    const { data: existingRaw } = await supabase
      .from("schedule_notifications")
      .select("shift_id")
      .eq("facility_id", ctx.facilityId)
      .eq("notification_type", "shift_reminder")
      .in("shift_id", shiftIds)
    const alreadySent = new Set(
      ((existingRaw ?? []) as Array<{ shift_id: string | null }>)
        .map((r) => r.shift_id)
        .filter((x): x is string => !!x),
    )

    const toSend = shifts.filter((s) => !alreadySent.has(s.id))
    if (toSend.length === 0) {
      return { ok: true, message: "All shifts in this window already have reminders.", count: 0 }
    }

    const inserts = toSend.map((s) => ({
      facility_id: ctx.facilityId,
      employee_id: s.employee_id,
      notification_type: "shift_reminder" as const,
      shift_id: s.id,
      payload: {
        starts_at: s.starts_at,
        ends_at: s.ends_at,
        message: `Reminder: your shift starts soon.`,
      },
    }))

    const { error: insErr } = await supabase
      .from("schedule_notifications")
      .insert(inserts)

    if (insErr) return { ok: false, error: dbError(insErr, "Failed to send reminders.") }

    revalidatePath("/admin/scheduling/notifications")
    return {
      ok: true,
      message: `${toSend.length} reminder${toSend.length === 1 ? "" : "s"} sent.`,
      count: toSend.length,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}
