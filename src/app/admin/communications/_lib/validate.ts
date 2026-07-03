// Pure form parsing/validation for the Communications admin actions. NO
// server-only imports live here, so this module is unit-testable in isolation
// (see validate.test.ts) and re-used by the server-only `../actions.ts`.

import { type Severity, isSeverity } from "../types"

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const ROLE_KEY_RE = /^[a-z0-9]+(_[a-z0-9]+)*$/
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
}

export function nonEmpty(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

export function asInt(value: FormDataEntryValue | null): number | null {
  const s = nonEmpty(value)
  if (s === null) return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

export type TargetKind = "group" | "role" | "employee" | "department"

export function isTargetKind(v: string): v is TargetKind {
  return v === "group" || v === "role" || v === "employee" || v === "department"
}

export const ALLOWED_TIMINGS = [
  "immediate",
  "end_of_day",
  "weekly",
  "manual",
] as const
export type Timing = (typeof ALLOWED_TIMINGS)[number]
export function isTiming(s: string): s is Timing {
  return (ALLOWED_TIMINGS as readonly string[]).includes(s)
}

export type RoutingFormResult =
  | {
      ok: true
      data: {
        name: string | null
        source_module: string
        severity: Severity | null
        area_id: string | null
        target_group_id: string | null
        target_role_key: string | null
        target_employee_id: string | null
        target_department_id: string | null
        timing: Timing
        attach_pdf: boolean
        requires_acknowledgement: boolean
        priority: number
        is_active: boolean
      }
    }
  | { ok: false; error: string }

export function parseRoutingForm(formData: FormData): RoutingFormResult {
  const source_module = nonEmpty(formData.get("source_module"))
  if (!source_module)
    return { ok: false, error: "Source module is required." }

  const sevRaw = nonEmpty(formData.get("severity"))
  let severity: Severity | null = null
  if (sevRaw && sevRaw !== "any") {
    if (!isSeverity(sevRaw)) return { ok: false, error: "Invalid severity." }
    severity = sevRaw
  }

  const area_id = nonEmpty(formData.get("area_id"))
  if (area_id && !UUID_RE.test(area_id)) {
    return {
      ok: false,
      error: "Area ID must be a valid UUID, or leave it blank.",
    }
  }

  const targetKindRaw = nonEmpty(formData.get("target_kind")) ?? ""
  if (!isTargetKind(targetKindRaw)) {
    return { ok: false, error: "Pick a target type (group, role, or employee)." }
  }
  let target_group_id: string | null = null
  let target_role_key: string | null = null
  let target_employee_id: string | null = null
  let target_department_id: string | null = null
  if (targetKindRaw === "group") {
    target_group_id = nonEmpty(formData.get("target_group_id"))
    if (!target_group_id)
      return { ok: false, error: "Pick a target group." }
  } else if (targetKindRaw === "role") {
    target_role_key = nonEmpty(formData.get("target_role_key"))
    if (!target_role_key)
      return { ok: false, error: "Pick a target role." }
    if (!ROLE_KEY_RE.test(target_role_key))
      return { ok: false, error: "Invalid role key." }
  } else if (targetKindRaw === "department") {
    target_department_id = nonEmpty(formData.get("target_department_id"))
    if (!target_department_id)
      return { ok: false, error: "Pick a target department." }
    if (!UUID_RE.test(target_department_id))
      return { ok: false, error: "Invalid department id." }
  } else {
    target_employee_id = nonEmpty(formData.get("target_employee_id"))
    if (!target_employee_id)
      return { ok: false, error: "Pick a target employee." }
  }

  const priority = asInt(formData.get("priority")) ?? 0
  const is_active = formData.get("is_active") !== "off"
  const name = nonEmpty(formData.get("name"))

  const timingRaw = nonEmpty(formData.get("timing")) ?? "immediate"
  if (!isTiming(timingRaw)) {
    return { ok: false, error: "Invalid timing value." }
  }
  const attach_pdf = formData.get("attach_pdf") === "on"
  const requires_acknowledgement =
    formData.get("requires_acknowledgement") === "on"

  return {
    ok: true,
    data: {
      name,
      source_module,
      severity,
      area_id,
      target_group_id,
      target_role_key,
      target_employee_id,
      target_department_id,
      timing: timingRaw,
      attach_pdf,
      requires_acknowledgement,
      priority,
      is_active,
    },
  }
}

export type ReminderFormResult =
  | {
      ok: true
      data: {
        name: string
        schedule_cron: string
        template_id: string
        target_group_id: string | null
        target_role_key: string | null
        next_run_at: string | null
        is_active: boolean
      }
    }
  | { ok: false; error: string }

export function parseReminderForm(formData: FormData): ReminderFormResult {
  const name = nonEmpty(formData.get("name"))
  if (!name) return { ok: false, error: "Name is required." }
  const schedule_cron = nonEmpty(formData.get("schedule_cron"))
  if (!schedule_cron)
    return { ok: false, error: "Schedule (cron) is required." }
  const cronParts = schedule_cron.split(/\s+/)
  if (cronParts.length !== 5) {
    return {
      ok: false,
      error: "Cron must have 5 fields, e.g. '0 8 * * 1'.",
    }
  }
  // Validate each cron field: only allow digits, *, -, /, and commas.
  if (cronParts.some((p) => !/^[\d*/,\-]+$/.test(p))) {
    return {
      ok: false,
      error: "Cron fields may only contain digits, *, -, /, and commas.",
    }
  }
  const template_id = nonEmpty(formData.get("template_id"))
  if (!template_id) return { ok: false, error: "Pick a template." }

  const targetKindRaw = nonEmpty(formData.get("target_kind")) ?? ""
  let target_group_id: string | null = null
  let target_role_key: string | null = null
  if (targetKindRaw === "group") {
    target_group_id = nonEmpty(formData.get("target_group_id"))
    if (!target_group_id)
      return { ok: false, error: "Pick a target group." }
  } else if (targetKindRaw === "role") {
    target_role_key = nonEmpty(formData.get("target_role_key"))
    if (!target_role_key) return { ok: false, error: "Pick a target role." }
    if (!ROLE_KEY_RE.test(target_role_key))
      return { ok: false, error: "Invalid role key." }
  } else {
    return { ok: false, error: "Pick a target type (group or role)." }
  }
  const next_run_raw = nonEmpty(formData.get("next_run_at"))
  let next_run_at: string | null = null
  if (next_run_raw) {
    const d = new Date(next_run_raw)
    if (Number.isNaN(d.getTime())) {
      return { ok: false, error: "Next run timestamp is invalid." }
    }
    next_run_at = d.toISOString()
  }
  const is_active = formData.get("is_active") !== "off"
  return {
    ok: true,
    data: {
      name,
      schedule_cron,
      template_id,
      target_group_id,
      target_role_key,
      next_run_at,
      is_active,
    },
  }
}
