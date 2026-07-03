export type ExportSettingsRow = {
  id: string
  facility_id: string
  logo_url: string | null
  header_text: string | null
  footer_text: string | null
  paper_size: "letter" | "a4"
  date_format: "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD"
  csv_delimiter: "comma" | "tab" | "semicolon"
  include_facility_name: boolean
  include_date: boolean
  include_submitted_by: boolean
  module_column_visibility: Record<string, string[]>
  created_at: string
  updated_at: string | null
}

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }

export const PAPER_SIZES = [
  { value: "letter", label: "Letter (8.5 × 11 in)" },
  { value: "a4", label: "A4 (210 × 297 mm)" },
] as const

export const DATE_FORMATS = [
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY (US)" },
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY (International)" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD (ISO 8601)" },
] as const

export const CSV_DELIMITERS = [
  { value: "comma", label: "Comma ( , )" },
  { value: "tab", label: "Tab ( → )" },
  { value: "semicolon", label: "Semicolon ( ; )" },
] as const

export const MODULE_COLUMN_OPTIONS: Record<string, { key: string; label: string }[]> = {
  daily_reports: [
    { key: "area", label: "Area" },
    { key: "template", label: "Template name" },
    { key: "submitted_by", label: "Submitted by" },
    { key: "submitted_at", label: "Date/time" },
    { key: "checklist_items", label: "Checklist responses" },
    { key: "notes", label: "Notes" },
  ],
  incident_reports: [
    { key: "incident_type", label: "Incident type" },
    { key: "severity", label: "Severity" },
    { key: "location", label: "Location" },
    { key: "description", label: "Description" },
    { key: "submitted_by", label: "Submitted by" },
    { key: "submitted_at", label: "Date/time" },
    { key: "status", label: "Status" },
  ],
  accident_reports: [
    { key: "injured_person", label: "Injured person" },
    { key: "body_parts", label: "Body parts affected" },
    { key: "nature_of_injury", label: "Nature of injury" },
    { key: "description", label: "Description" },
    { key: "witnesses", label: "Witnesses" },
    { key: "submitted_by", label: "Submitted by" },
    { key: "submitted_at", label: "Date/time" },
  ],
  refrigeration: [
    { key: "section", label: "Section" },
    { key: "equipment", label: "Equipment" },
    { key: "readings", label: "Readings" },
    { key: "thresholds_exceeded", label: "Threshold alerts" },
    { key: "submitted_by", label: "Submitted by" },
    { key: "submitted_at", label: "Date/time" },
  ],
  air_quality: [
    { key: "location", label: "Location" },
    { key: "readings", label: "Readings" },
    { key: "thresholds_exceeded", label: "Threshold alerts" },
    { key: "submitted_by", label: "Submitted by" },
    { key: "submitted_at", label: "Date/time" },
  ],
  ice_depth: [
    { key: "layout", label: "Rink layout" },
    { key: "cell_readings", label: "Cell readings" },
    { key: "min_depth", label: "Min depth" },
    { key: "max_depth", label: "Max depth" },
    { key: "avg_depth", label: "Average depth" },
    { key: "submitted_by", label: "Submitted by" },
    { key: "submitted_at", label: "Date/time" },
  ],
  ice_operations: [
    { key: "operation_type", label: "Operation type" },
    { key: "duration", label: "Duration" },
    { key: "notes", label: "Notes" },
    { key: "submitted_by", label: "Submitted by" },
    { key: "submitted_at", label: "Date/time" },
  ],
  communications: [
    { key: "subject", label: "Subject" },
    { key: "body", label: "Message" },
    { key: "requires_ack", label: "Requires acknowledgement" },
    { key: "sender", label: "Sender" },
    { key: "sent_at", label: "Sent at" },
    { key: "recipient_count", label: "Recipients" },
    { key: "read_count", label: "Read count" },
    { key: "ack_count", label: "Acknowledged count" },
  ],
}

export const MODULE_LABELS: Record<string, string> = {
  daily_reports: "Daily Reports",
  incident_reports: "Incident Reports",
  accident_reports: "Accident Reports",
  refrigeration: "Refrigeration",
  air_quality: "Air Quality",
  ice_depth: "Ice Depth",
  ice_operations: "Ice Operations",
}
