export type RetentionRow = {
  id: string
  facility_id: string
  module_key: string
  keep_days: number
  auto_purge: boolean
  created_at: string
  updated_at: string | null
}

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }

export const MODULES: ReadonlyArray<{ key: string; label: string; description: string }> = [
  {
    key: "daily_reports",
    label: "Daily Reports",
    description: "Checklist submission history.",
  },
  {
    key: "ice_depth",
    label: "Ice Depth",
    description: "Ice depth measurement sessions.",
  },
  {
    key: "ice_operations",
    label: "Ice Operations",
    description: "Resurfacer, edging, and blade change logs.",
  },
  {
    key: "incident_reports",
    label: "Incident Reports",
    description: "Staff and patron incident records.",
  },
  {
    key: "accident_reports",
    label: "Accident Reports",
    description: "Accident and workers' comp records.",
  },
  {
    key: "refrigeration",
    label: "Refrigeration",
    description: "Refrigeration system check reports.",
  },
  {
    key: "air_quality",
    label: "Air Quality",
    description: "Air quality reading history.",
  },
  {
    key: "scheduling",
    label: "Scheduling",
    description: "Past shifts, swaps, and time-off requests.",
  },
  {
    key: "communications",
    label: "Communications",
    description: "Messages and alerts.",
  },
  {
    key: "audit_logs",
    label: "Audit Log",
    description: "System audit trail entries.",
  },
]

export const PRESET_OPTIONS = [
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
  { label: "180 days", value: 180 },
  { label: "1 year", value: 365 },
  { label: "2 years", value: 730 },
  { label: "3 years", value: 1095 },
  { label: "5 years", value: 1825 },
] as const
