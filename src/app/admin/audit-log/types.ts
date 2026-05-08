import type { Tables } from "@/types/database"

export type AuditLogRow = Tables<"audit_logs">

export type EmployeeLite = {
  id: string
  first_name: string
  last_name: string
}

export type AuditLogEntry = AuditLogRow & {
  actor_employee: EmployeeLite | null
}

export type Tab = "log"

export const ACTION_LABELS: Record<string, string> = {
  create: "Create",
  update: "Update",
  delete: "Delete",
  login: "Login",
  logout: "Logout",
}

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  facility: "Facility",
  employee: "Employee",
  role: "Role",
  department: "Department",
  module_permission: "Module Permission",
  daily_report: "Daily Report",
  ice_depth_session: "Ice Depth Session",
  ice_operations_submission: "Ice Operations Submission",
  incident_report: "Incident Report",
  accident_report: "Accident Report",
  refrigeration_report: "Refrigeration Report",
  air_quality_report: "Air Quality Report",
  shift: "Shift",
  communication_message: "Message",
  retention_settings: "Retention Settings",
  export_settings: "Export Settings",
}
