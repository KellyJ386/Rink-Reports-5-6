import type { Tables } from "@/types/database"

export type CommunicationAlert = Tables<"communication_alerts">
export type CommunicationAcknowledgement =
  Tables<"communication_acknowledgements">
export type CommunicationMessage = Tables<"communication_messages">
export type CommunicationRecipient = Tables<"communication_recipients">
export type CommunicationGroup = Tables<"communication_groups">
export type CommunicationGroupMember = Tables<"communication_group_members">
export type CommunicationTemplate = Tables<"communication_templates">

/**
 * Severity values used by `communication_alerts.severity`. The DB column is
 * free-form text but the application enforces the values listed in the spec.
 */
export type AlertSeverity = "info" | "warn" | "high" | "critical"

/**
 * Source modules that can produce alerts. Mirrors the spec.
 */
export type AlertSourceModule =
  | "ice_operations"
  | "refrigeration"
  | "accident_reports"
  | "air_quality"
  | "incident_reports"
  | "scheduling"

export type InboxTab = "alerts" | "messages"

/**
 * One alert row enriched with the current employee's ack state (if any).
 */
export type AlertWithAck = CommunicationAlert & {
  ack: Pick<
    CommunicationAcknowledgement,
    "id" | "acknowledged_at" | "notes"
  > | null
}

/**
 * One inbound message row enriched with the recipient row for the current
 * employee (so we know read/ack state) and a sender display name.
 */
export type MessageInboxItem = {
  recipient: Pick<
    CommunicationRecipient,
    | "id"
    | "message_id"
    | "employee_id"
    | "facility_id"
    | "delivered_at"
    | "read_at"
    | "acknowledged_at"
    | "created_at"
    | "email_status"
    | "email_sent_at"
    | "email_error"
    | "email_attempts"
    | "email_next_attempt_at"
  >
  message: CommunicationMessage
  senderName: string | null
}
