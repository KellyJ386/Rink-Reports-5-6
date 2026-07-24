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

/**
 * Retention-configurable modules.
 *
 * `minDays` is a DISPLAY MIRROR of `public.retention_module_floors`, which is
 * the authoritative source and is enforced by a BEFORE INSERT/UPDATE trigger on
 * retention_settings (migration 208). It is used here only for the number
 * input's `min` attribute and the preset filter. Never treat it as the
 * enforcement point — it living here alone, unenforced server-side, was the
 * data-loss defect migration 208 closed.
 *
 * Two modules are deliberately absent:
 *  - `audit_logs`   — fixed at a 7-year compliance window by
 *                     purge_old_audit_logs() and purge_module_data(); it never
 *                     read retention_settings, so the row shown here was a
 *                     setting that did nothing.
 *  - `scheduling`   — purge_module_data() raises "Manual purge is not supported
 *                     for scheduling" and no purge_old_scheduling() exists, so
 *                     the row was settable but permanently inert.
 */
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
    key: "communications",
    label: "Communications",
    description: "Messages and alerts.",
    minDays: 30,
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
