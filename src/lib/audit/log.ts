import "server-only"

import { headers } from "next/headers"

import { getCurrentUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

export type LogAuditInput = {
  facilityId: string
  action: string
  entityType: string
  entityId?: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}

/**
 * Append a row to audit_logs from app code.
 *
 * Prefer DB triggers (migration 41) for raw row-change auditing. Use this
 * helper for events that do NOT correspond to a DB mutation — for example
 * "PDF emailed", "schedule published" with a business label, or "sensitive
 * report viewed".
 *
 * Fire-and-best-effort: never throws. A failure here must never block the
 * action it accompanies.
 */
export async function logAudit(input: LogAuditInput): Promise<void> {
  try {
    const supabase = await createClient()
    const current = await getCurrentUser()

    let employeeId: string | null = null
    const authUserId = current?.authUser?.id ?? null
    if (authUserId) {
      const { data: emp } = await supabase
        .from("employees")
        .select("id")
        .eq("user_id", authUserId)
        .eq("facility_id", input.facilityId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle<{ id: string }>()
      employeeId = emp?.id ?? null
    }

    const h = await headers()
    const ipRaw = h.get("x-forwarded-for") ?? null
    const ip = ipRaw ? ipRaw.split(",")[0]?.trim() || null : null
    const ua = h.get("user-agent") ?? null

    await supabase.from("audit_logs").insert({
      facility_id: input.facilityId,
      actor_user_id: authUserId,
      actor_employee_id: employeeId,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      before: (input.before ?? null) as never,
      after: (input.after ?? null) as never,
      ip,
      user_agent: ua,
    })
  } catch {
    // Auditing is best-effort. Don't surface the failure.
  }
}
