// Pure constants/helpers for the scheduling governance module. Kept separate
// from `governance-actions.ts` because the `"use server"` directive requires
// every export in that file to be an async function.

import type { Json } from "@/types/database"

export const COMPLIANCE_RULE_TYPES = [
  "minor_max_hours",
  "overtime",
  "break_required",
  "certification_required",
  "min_rest_between_shifts",
  "custom",
] as const
export type ComplianceRuleType = (typeof COMPLIANCE_RULE_TYPES)[number]

export function isComplianceRuleType(v: string): v is ComplianceRuleType {
  return (COMPLIANCE_RULE_TYPES as readonly string[]).includes(v)
}

export type CreateComplianceRuleInput = {
  rule_type: ComplianceRuleType
  name: string
  params: { [k: string]: Json }
  description?: string | null
  is_active?: boolean
  sort_order?: number | null
}

export type UpdateComplianceRulePatch = {
  name?: string
  description?: string | null
  is_active?: boolean
  sort_order?: number | null
  params_patch?: { [k: string]: Json }
  // When set, replaces params entirely (used for `custom` raw JSON edits).
  params_replace?: { [k: string]: Json }
}

export type SchedulingSettingsInput = {
  week_start_day: number
  default_shift_minutes: number
  minor_max_weekly_hours: number | null
  overtime_weekly_hours: number | null
  minimum_break_minutes: number | null
  minimum_break_after_hours: number | null
  swap_requires_manager_approval: boolean
  swap_expiry_hours: number
  open_shift_first_come: boolean
  notify_on_publish: boolean
  notify_on_overtime: boolean
  availability_submission_enabled: boolean
  require_job_area_qualification: boolean
  block_on_violations: boolean
}
