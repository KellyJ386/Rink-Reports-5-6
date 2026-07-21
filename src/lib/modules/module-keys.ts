// Pure module-key constants shared by server and client (no server-only deps,
// so client components like the admin toggle list can import them). The
// server-only fetch helper lives in ./facility-modules.

// Module keys that map to a toggleable staff-nav entry. Must stay in sync with
// the seed in migration 144 (seed_default_facility_modules) and the moduleKey
// tags on the staff NAV_ITEMS. Dashboard and Admin Center are never toggleable.
export const TOGGLEABLE_MODULE_KEYS = [
  "daily_reports",
  "ice_depth",
  "ice_operations",
  "refrigeration",
  "air_quality",
  "incident_reports",
  "accident_reports",
  "scheduling",
  "communications",
  "facility_paperwork",
  "dasher_boards",
] as const

export type ToggleableModuleKey = (typeof TOGGLEABLE_MODULE_KEYS)[number]

export const MODULE_LABELS: Record<ToggleableModuleKey, string> = {
  daily_reports: "Daily Reports",
  ice_depth: "Ice Depth",
  ice_operations: "Ice Operations",
  refrigeration: "Refrigeration",
  air_quality: "Air Quality",
  incident_reports: "Incidents",
  accident_reports: "Accidents",
  scheduling: "Scheduling",
  communications: "Communications",
  facility_paperwork: "Facility Paperwork",
  dasher_boards: "Dasher Boards",
}
