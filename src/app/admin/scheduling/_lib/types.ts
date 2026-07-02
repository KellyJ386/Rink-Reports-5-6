// Shared types for the Scheduling admin module (Agent B scope).
// Row types come from generated Supabase types; we layer composite shapes
// on top.

import type { Tables } from "@/types/database"

export type ShiftRow = Tables<"schedule_shifts">
export type TemplateRow = Tables<"schedule_templates">
export type TemplateShiftRow = Tables<"schedule_template_shifts">
export type PublishEventRow = Tables<"schedule_publish_events">
export type SettingsRow = Tables<"schedule_settings">
export type DepartmentRow = Tables<"departments">
export type OpenShiftRow = Tables<"schedule_open_shifts">
export type TimeOffRow = Tables<"schedule_time_off_requests">
export type SwapRequestRow = Tables<"schedule_swap_requests">

export type EmployeeLite = {
  id: string
  first_name: string
  last_name: string
  is_minor: boolean
  is_active: boolean
  // Added by migration 128; optional so existing selects that omit it still fit.
  max_weekly_hours?: number | null
}

export type DepartmentLite = {
  id: string
  name: string
  slug: string
  color: string | null
  is_active: boolean
}

export type JobAreaLite = {
  id: string
  name: string
  slug: string
  is_active: boolean
}

export type ShiftWithRefs = ShiftRow & {
  employee: EmployeeLite | null
  department: DepartmentLite | null
  job_area: JobAreaLite | null
}

export const SHIFT_STATUSES = ["draft", "published", "cancelled"] as const
export type ShiftStatus = (typeof SHIFT_STATUSES)[number]
export function isShiftStatus(v: string): v is ShiftStatus {
  return (SHIFT_STATUSES as readonly string[]).includes(v)
}

export const SHIFT_VIEWS = ["day", "week", "month", "employee", "department"] as const
export type ShiftView = (typeof SHIFT_VIEWS)[number]
export function asShiftView(v: string | undefined): ShiftView {
  return (SHIFT_VIEWS as readonly string[]).includes(v ?? "")
    ? (v as ShiftView)
    : "week"
}

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }

export type SimpleResult = { ok: true } | { ok: false; error: string }

export type CreateShiftInput = {
  department_id: string
  job_area_id: string | null
  employee_id: string | null
  starts_at: string // ISO
  ends_at: string // ISO
  break_minutes: number | null
  role_label: string | null
  notes: string | null
  status: ShiftStatus
}

export type UpdateShiftInput = Partial<CreateShiftInput>

export type CreateTemplateInput = {
  name: string
  slug: string
  description: string | null
  is_active: boolean
}

export type CreateTemplateShiftInput = {
  template_id: string
  department_id: string
  job_area_id: string | null
  day_of_week: number
  start_time: string // HH:MM[:SS]
  end_time: string // HH:MM[:SS]
  break_minutes: number | null
  role_label: string | null
  staff_count: number
}
