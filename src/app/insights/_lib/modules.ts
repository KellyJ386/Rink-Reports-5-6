// The nine modules the reporting layer covers — the exact set
// supabase/migrations/00000000000270_daily_metrics_rollup_functions.sql and
// 00000000000271_compute_live_daily_metrics.sql dispatch on. This is a
// narrower, SQL-defined subset of the full permission module list
// (MODULE_NAMES in @/lib/permissions), not a competing source of truth —
// labels are reused from @/lib/modules/module-keys rather than redeclared
// here.

import type { ModuleKey as ThemeModuleKey } from "@/components/ui/module-theme"

export const REPORT_MODULE_KEYS = [
  "daily_reports",
  "ice_operations",
  "ice_depth",
  "refrigeration",
  "air_quality",
  "incident_reports",
  "accident_reports",
  "dasher_boards",
  "scheduling",
] as const

export type ReportModuleKey = (typeof REPORT_MODULE_KEYS)[number]

export function isReportModuleKey(value: string): value is ReportModuleKey {
  return (REPORT_MODULE_KEYS as readonly string[]).includes(value)
}

/** Maps a report module key to its module-theme.ts accent key, for card tinting. */
export const REPORT_MODULE_THEME_KEY: Record<ReportModuleKey, ThemeModuleKey> = {
  daily_reports: "daily",
  ice_operations: "ice-ops",
  ice_depth: "ice-depth",
  refrigeration: "refrig",
  air_quality: "air",
  incident_reports: "incidents",
  accident_reports: "accidents",
  dasher_boards: "dasher",
  scheduling: "scheduling",
}
