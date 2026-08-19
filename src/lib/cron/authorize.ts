// Cron request authorization — the timing-safe Bearer check that all seven
// cron routes share.
//
// Kept pure and dependency-free (node:crypto only) so it can be unit-tested
// under vitest's plain-Node environment, per CLAUDE.md. The wrapper that uses
// it lives in ./with-cron-auth, which pulls in server-only modules.

import { createHash, timingSafeEqual } from "node:crypto"

/**
 * Constant-time comparison of an `Authorization: Bearer <secret>` header
 * against the configured CRON_SECRET.
 *
 * Both sides are hashed first so the comparison operates on fixed-length
 * buffers — timingSafeEqual throws on a length mismatch, which would otherwise
 * leak the secret's length through the error path.
 */
export function authorizeCronRequest(
  header: string | null | undefined,
  secret: string,
): boolean {
  if (!header) return false
  if (!secret) return false
  const expected = `Bearer ${secret}`
  const a = createHash("sha256").update(header).digest()
  const b = createHash("sha256").update(expected).digest()
  return a.length === b.length && timingSafeEqual(a, b)
}
