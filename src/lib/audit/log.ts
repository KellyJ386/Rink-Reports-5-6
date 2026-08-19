import "server-only"

import { headers } from "next/headers"

import { getCurrentUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { buildAuditRow, type LogAuditInput } from "./build"

export type { LogAuditInput }

/**
 * Append a row to audit_logs from app code.
 *
 * Prefer DB triggers (migration 41) for raw row-change auditing. Use this
 * helper for events that do NOT correspond to a DB mutation — for example
 * "PDF emailed", "schedule published" with a business label, or "sensitive
 * report viewed".
 *
 * Best-effort: never throws — a failure here must never block the action it
 * accompanies — but failures are NEVER silent. Every failed write is logged
 * with enough context to reconstruct the missing entry, and callers get a
 * boolean so security-critical paths can escalate. (The original version
 * discarded the insert result AND swallowed exceptions in an empty catch, so
 * the audit trail could develop holes with no operational trace.)
 */
export async function logAudit(input: LogAuditInput): Promise<boolean> {
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
    const row = buildAuditRow(
      input,
      { authUserId, employeeId },
      {
        realIp: h.get("x-real-ip"),
        forwardedFor: h.get("x-forwarded-for"),
        userAgent: h.get("user-agent"),
      }
    )

    const { error } = await supabase.from("audit_logs").insert({
      ...row,
      before: row.before as never,
      after: row.after as never,
    })
    if (error) {
      console.error(
        `[audit] failed to record ${input.action} on ${input.entityType}` +
          `${input.entityId ? `/${input.entityId}` : ""} ` +
          `(facility ${input.facilityId}): ${error.message}`
      )
      return false
    }
    return true
  } catch (err) {
    console.error(
      `[audit] failed to record ${input.action} on ${input.entityType} ` +
        `(facility ${input.facilityId}):`,
      err
    )
    return false
  }
}
