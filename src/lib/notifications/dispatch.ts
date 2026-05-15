import "server-only"

import { createClient } from "@/lib/supabase/server"

export type DispatchInput = {
  facilityId: string
  sourceModule: string
  sourceRecordId: string
  severity?: string | null
  areaId?: string | null
  subject?: string | null
  body?: string | null
}

/**
 * Fans out a submission event to every matching routing rule. Never throws —
 * a bug in dispatch must not block the submission itself. Errors are logged
 * to the console and best-effort to audit_logs (via the SQL trigger that's
 * attached to dispatch_rules_for_submission's writes).
 *
 * Returns the count of outbox rows enqueued, or 0 on any error.
 */
export async function dispatchRulesForSubmission(
  input: DispatchInput,
): Promise<number> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("dispatch_rules_for_submission", {
      p_facility_id: input.facilityId,
      p_source_module: input.sourceModule,
      p_source_record_id: input.sourceRecordId,
      p_severity: input.severity ?? undefined,
      p_area_id: input.areaId ?? undefined,
      p_subject: input.subject ?? undefined,
      p_body: input.body ?? undefined,
    })
    if (error) {
      console.error("[notifications] dispatch failed:", error)
      return 0
    }
    return Number(data ?? 0)
  } catch (e) {
    console.error("[notifications] dispatch threw:", e)
    return 0
  }
}

/**
 * Preview a single rule's resolved recipients. Used by the rule editor's
 * "Preview Recipients" button. Returns employee IDs only — the caller is
 * expected to join to employees in the UI.
 */
export async function previewRuleRecipients(ruleId: string): Promise<string[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("resolve_rule_recipients", {
    p_rule_id: ruleId,
  })
  if (error || !data) return []
  return data.map((r) => r.employee_id)
}
