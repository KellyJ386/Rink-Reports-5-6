// Pure row-assembly for app-level audit entries. Split from log.ts (which is
// server-only and untestable under the pure-vitest rule) so the shape of what
// we write to audit_logs is unit-tested.

export type LogAuditInput = {
  facilityId: string
  action: string
  entityType: string
  entityId?: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}

export type AuditRow = {
  facility_id: string
  actor_user_id: string | null
  actor_employee_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  ip: string | null
  user_agent: string | null
}

/**
 * Trusted client IP for the audit trail, or null when it can't be derived.
 *
 * Same derivation as the login and information-requests rate limiters:
 * prefer x-real-ip (set by the Vercel edge to the true client IP,
 * overwriting any client-sent value), else the RIGHTMOST x-forwarded-for
 * hop (appended by our own trusted proxy) — never the leftmost, which is
 * whatever the client chose to send. The previous leftmost-hop version let
 * a client stamp an arbitrary (or even non-inet, insert-breaking) value
 * into hash-chained audit rows.
 */
export function trustedClientIp(
  realIp: string | null,
  forwardedFor: string | null
): string | null {
  const real = realIp?.trim()
  if (real) return real
  if (!forwardedFor) return null
  const hops = forwardedFor
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean)
  return hops[hops.length - 1] ?? null
}

export function buildAuditRow(
  input: LogAuditInput,
  actor: { authUserId: string | null; employeeId: string | null },
  request: {
    realIp: string | null
    forwardedFor: string | null
    userAgent: string | null
  }
): AuditRow {
  return {
    facility_id: input.facilityId,
    actor_user_id: actor.authUserId,
    actor_employee_id: actor.employeeId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    ip: trustedClientIp(request.realIp, request.forwardedFor),
    user_agent: request.userAgent,
  }
}
