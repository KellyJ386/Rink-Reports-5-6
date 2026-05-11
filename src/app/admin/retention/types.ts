export type RetentionRow = {
  id: string
  facility_id: string
  module_key: string
  keep_days: number
  auto_purge: boolean
  last_purged_at: string | null
  last_purge_count: number | null
  created_at: string
  updated_at: string | null
}

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }

export const MODULES: ReadonlyArray<{
  key: string
  label: string
  description: string
  minDays: number
}> = [
  {
    key: "daily_reports",
    label: "Daily Reports",
    description: "Checklist submission history.",
    minDays: 30,
  },
  {
    key: "ice_depth",
    label: "Ice Depth",
    description: "Ice depth measurement sessions.",
    minDays: 30,
  },
  {
    key: "ice_operations",
    label: "Ice Operations",
    description: "Resurfacer, edging, and blade change logs.",
    minDays: 30,
  },
  {
    key: "incident_reports",
    label: "Incident Reports",
    description: "Staff and patron incident records.",
    minDays: 365,
  },
  {
    key: "accident_reports",
    label: "Accident Reports",
    description: "Accident and workers' comp records. Check local regulatory requirements.",
    minDays: 365,
  },
  {
    key: "refrigeration",
    label: "Refrigeration",
    description: "Refrigeration system check reports.",
    minDays: 90,
  },
  {
    key: "air_quality",
    label: "Air Quality",
    description: "Air quality reading history.",
    minDays: 90,
  },
  {
    key: "scheduling",
    label: "Scheduling",
    description: "Past shifts, swaps, and time-off requests.",
    minDays: 90,
  },
  {
    key: "communications",
    label: "Communications",
    description: "Messages and alerts.",
    minDays: 30,
  },
  {
    key: "audit_logs",
    label: "Audit Log",
    description: "System audit trail entries.",
    minDays: 365,
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
  { label: "Forever (no purge)", value: 0 },
] as const
