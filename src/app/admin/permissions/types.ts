// Local route-scoped types. Generated Supabase types are not available yet,
// so these are hand-rolled to match the backbone schema (see
// supabase/migrations/00000000000002_backbone_schema.sql).

export const MODULE_KEYS = [
  "daily_reports",
  "ice_depth",
  "ice_operations",
  "incident_reports",
  "accident_reports",
  "refrigeration",
  "air_quality",
  "scheduling",
  "communications",
  "admin",
] as const

export type ModuleKey = (typeof MODULE_KEYS)[number]

export const MODULE_LABELS: Record<ModuleKey, string> = {
  daily_reports: "Daily Reports",
  ice_depth: "Ice Depth",
  ice_operations: "Ice Ops",
  incident_reports: "Incidents",
  accident_reports: "Accidents",
  refrigeration: "Refrigeration",
  air_quality: "Air Quality",
  scheduling: "Scheduling",
  communications: "Comms",
  admin: "Admin",
}

export type PermissionField = "can_view" | "can_submit" | "can_admin"

export type PermissionFlags = {
  can_view: boolean
  can_submit: boolean
  can_admin: boolean
}

export type Employee = {
  id: string
  full_name: string
  email: string | null
  role_key: string | null
  role_display_name: string | null
  departments: string[]
}

export type PermissionMap = Record<string, Partial<Record<ModuleKey, PermissionFlags>>>

export const EMPTY_FLAGS: PermissionFlags = {
  can_view: false,
  can_submit: false,
  can_admin: false,
}
