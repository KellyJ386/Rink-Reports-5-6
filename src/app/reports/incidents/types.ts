import type { Tables } from "@/types/database"

export type IncidentType = Tables<"incident_types">
export type IncidentSeverityLevel = Tables<"incident_severity_levels">
export type IncidentReport = Tables<"incident_reports">

/**
 * Status values used for incident_reports.status. The DB column is a free-form
 * text column today; this union captures the values the application uses.
 */
export type IncidentStatus =
  | "submitted"
  | "in_review"
  | "resolved"
  | "archived"
