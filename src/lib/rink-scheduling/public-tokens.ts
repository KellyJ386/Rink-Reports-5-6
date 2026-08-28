import "server-only"

import { createHash } from "node:crypto"

import { isPlausibleDisplayToken } from "@/lib/rink-scheduling/locker-display"
import type { createAdminClient } from "@/lib/supabase/admin"
import type { Tables } from "@/types/database"

type AdminClient = ReturnType<typeof createAdminClient>

export type DisplayTokenType = Tables<"rink_display_tokens">["display_type"]

export type ResolvedToken = {
  id: string
  facilityId: string
  label: string
  displayType: string
  settings: unknown
  lastSeenAt: string | null
}

/**
 * Validate a public token of a specific type and return its row facts.
 *
 * One resolver for every tokened public surface (TV boards, ICS feeds, the
 * request form) so the security posture cannot drift between them: shape
 * check first (no query for junk), sha256 lookup, and one indistinguishable
 * null for "malformed", "unknown", "revoked", "inactive" and "wrong type" —
 * distinguishing them would confirm which guesses were close.
 */
export async function resolvePublicToken(
  admin: AdminClient,
  rawToken: unknown,
  expectedType: string,
): Promise<ResolvedToken | null> {
  if (!isPlausibleDisplayToken(rawToken)) return null

  const tokenHash = createHash("sha256").update(rawToken).digest("hex")
  const { data: row, error } = await admin
    .from("rink_display_tokens")
    .select("id, facility_id, label, display_type, settings, is_active, revoked_at, last_seen_at")
    .eq("token_hash", tokenHash)
    .maybeSingle()
  if (error) throw error

  if (!row || !row.is_active || row.revoked_at) return null
  if (row.display_type !== expectedType) return null

  return {
    id: row.id,
    facilityId: row.facility_id,
    label: row.label,
    displayType: row.display_type,
    settings: row.settings,
    lastSeenAt: row.last_seen_at,
  }
}

const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60_000

/**
 * Stamp last_seen_at at most every five minutes. Fire-and-forget: a public
 * surface that cannot record its heartbeat should still serve, so failures
 * are swallowed rather than surfaced.
 */
export async function touchTokenLastSeen(
  admin: AdminClient,
  token: Pick<ResolvedToken, "id" | "lastSeenAt">,
  nowMs: number,
): Promise<void> {
  try {
    const previous = token.lastSeenAt ? Date.parse(token.lastSeenAt) : Number.NaN
    if (Number.isFinite(previous) && nowMs - previous < LAST_SEEN_WRITE_INTERVAL_MS) return
    await admin
      .from("rink_display_tokens")
      .update({ last_seen_at: new Date(nowMs).toISOString() })
      .eq("id", token.id)
  } catch {
    // Intentionally silent.
  }
}
