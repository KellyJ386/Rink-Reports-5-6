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

/** First hop of an x-forwarded-for list, or null when absent/blank. */
export function firstForwardedIp(raw: string | null): string | null {
  if (!raw) return null
  return raw.split(",")[0]?.trim() || null
}

export function buildAuditRow(
  input: LogAuditInput,
  actor: { authUserId: string | null; employeeId: string | null },
  request: { forwardedFor: string | null; userAgent: string | null }
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
    ip: firstForwardedIp(request.forwardedFor),
    user_agent: request.userAgent,
  }
}
