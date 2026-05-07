// Local types for the Ice Depth admin module.
// Row types come from generated Supabase types; we layer composite shapes on
// top.

import type { Tables } from "@/types/database"

export type SettingsRow = Tables<"ice_depth_settings">
export type LayoutRow = Tables<"ice_depth_layouts">
export type PointRow = Tables<"ice_depth_points">
export type SessionRow = Tables<"ice_depth_sessions">
export type MeasurementRow = Tables<"ice_depth_measurements">
export type FollowupNoteRow = Tables<"ice_depth_followup_notes">

export type EmployeeLite = {
  id: string
  first_name: string
  last_name: string
}

export type MeasurementUnit = "inches" | "mm"
export const MEASUREMENT_UNITS: readonly MeasurementUnit[] = ["inches", "mm"]
export function isMeasurementUnit(v: string): v is MeasurementUnit {
  return (MEASUREMENT_UNITS as readonly string[]).includes(v)
}

export type Severity = "warn" | "high" | "critical"
export const SEVERITIES: readonly Severity[] = ["warn", "high", "critical"]
export function isSeverity(v: string): v is Severity {
  return (SEVERITIES as readonly string[]).includes(v)
}

export type AlertOn = "low" | "high" | "any"
export const ALERT_ONS: readonly AlertOn[] = ["low", "high", "any"]
export function isAlertOn(v: string): v is AlertOn {
  return (ALERT_ONS as readonly string[]).includes(v)
}

export type ReadingSeverity = "low" | "ok" | "high"

export type Tab = "layouts" | "history" | "settings"
export const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "layouts", label: "Layouts" },
  { key: "history", label: "History" },
  { key: "settings", label: "Settings" },
]

export function asTab(value: string | undefined): Tab {
  const allowed = TABS.map((t) => t.key)
  return (allowed as readonly string[]).includes(value ?? "")
    ? (value as Tab)
    : "layouts"
}

// ---- Layouts tab composite ----

export type LayoutWithPointCount = LayoutRow & {
  active_point_count: number
  total_point_count: number
}

export type LayoutsData = {
  layouts: LayoutWithPointCount[]
  activeLayout: LayoutDetail | null
}

export type LayoutDetail = {
  layout: LayoutRow
  points: PointRow[]
}

// ---- History tab composite ----

export type SessionListItem = SessionRow & {
  layout: LayoutRow | null
  employee: EmployeeLite | null
}

export type SessionDetailData = {
  session: SessionRow
  layout: LayoutRow | null
  points: PointRow[]
  employee: EmployeeLite | null
  measurements: MeasurementRow[]
  notes: Array<FollowupNoteRow & { author: EmployeeLite | null }>
  settings: SettingsRow | null
}

// ---- History tab params ----

export type HistoryParams = {
  layout?: string
  employee?: string
  has_low?: string
  has_high?: string
  from?: string
  to?: string
}

// ---- Action plumbing ----

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }

export type SimpleResult = { ok: true } | { ok: false; error: string }
