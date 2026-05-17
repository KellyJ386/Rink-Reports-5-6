// Local types for the Communications admin module.

import type { Tables } from "@/types/database"

export type GroupRow = Tables<"communication_groups">
export type GroupMemberRow = Tables<"communication_group_members">
export type TemplateRow = Tables<"communication_templates">
export type MessageRow = Tables<"communication_messages">
export type RecipientRow = Tables<"communication_recipients">
export type AlertRow = Tables<"communication_alerts">
export type AcknowledgementRow = Tables<"communication_acknowledgements">
export type RoutingRuleRow = Tables<"communication_routing_rules">
export type ReminderRow = Tables<"communication_recurring_reminders">
export type AuditLogRow = Tables<"communication_audit_log">

export type EmployeeLite = {
  id: string
  first_name: string
  last_name: string
}

export type Severity = "info" | "warn" | "high" | "critical"
export const SEVERITIES: readonly Severity[] = [
  "info",
  "warn",
  "high",
  "critical",
] as const
export function isSeverity(v: string): v is Severity {
  return (SEVERITIES as readonly string[]).includes(v)
}

// Known role keys. Mirrors the seed values used elsewhere in the app; new
// keys can be added to the database without breaking existing rules — this
// is just the picker list.
export const ROLE_KEYS: readonly string[] = [
  "super_admin",
  "admin",
  "manager",
  "staff",
] as const

// Known source modules. Keep in sync with the rest of the rebuild.
export const SOURCE_MODULES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "ice_operations", label: "Ice Operations" },
  { key: "refrigeration", label: "Refrigeration" },
  { key: "accident_reports", label: "Accident Reports" },
  { key: "air_quality", label: "Air Quality" },
  { key: "incident_reports", label: "Incident Reports" },
  { key: "scheduling", label: "Scheduling" },
  { key: "communications", label: "Communications" },
  { key: "daily_reports", label: "Daily Reports" },
  { key: "ice_depth", label: "Ice Depth" },
] as const

export type Tab =
  | "inbox"
  | "templates"
  | "groups"
  | "routing"
  | "reminders"
  | "audit"

export const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "inbox", label: "Inbox" },
  { key: "templates", label: "Templates" },
  { key: "groups", label: "Groups" },
  { key: "routing", label: "Routing" },
  { key: "reminders", label: "Reminders" },
  { key: "audit", label: "Audit Log" },
]

export function asTab(value: string | undefined): Tab {
  const allowed = TABS.map((t) => t.key)
  return (allowed as readonly string[]).includes(value ?? "")
    ? (value as Tab)
    : "inbox"
}

export type InboxView = "alerts" | "messages"
export function asInboxView(value: string | undefined): InboxView {
  return value === "messages" ? "messages" : "alerts"
}

// ---- Composite shapes ----

export type AlertWithCounts = AlertRow & {
  ack_count: number
  resolved_by: EmployeeLite | null
  created_by: EmployeeLite | null
}

export type AlertDetailData = {
  alert: AlertRow
  acknowledgements: Array<AcknowledgementRow & { employee: EmployeeLite | null }>
  created_by: EmployeeLite | null
  resolved_by: EmployeeLite | null
}

export type MessageListItem = MessageRow & {
  sender: EmployeeLite | null
  recipient_count: number
  read_count: number
  ack_count: number
}

export type GroupWithCount = GroupRow & {
  member_count: number
}

export type GroupDetail = {
  group: GroupRow
  members: Array<GroupMemberRow & { employee: EmployeeLite | null }>
  facility_employees: EmployeeLite[]
}

// Columns added in migration 45 aren't yet in the generated RoutingRuleRow
// type. Override them explicitly so the UI can read them without an `any` cast.
export type RoutingRuleWithRefs = RoutingRuleRow & {
  target_group: GroupRow | null
  target_employee: EmployeeLite | null
  target_department_id: string | null
  timing: "immediate" | "end_of_day" | "weekly" | "manual" | null
  attach_pdf: boolean | null
  requires_acknowledgement: boolean | null
}

export type ReminderWithRefs = ReminderRow & {
  template: TemplateRow | null
  target_group: GroupRow | null
}

export type AuditLogItem = AuditLogRow & {
  actor: EmployeeLite | null
}

// ---- Action plumbing ----

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }

export type SimpleResult = { ok: true } | { ok: false; error: string }
