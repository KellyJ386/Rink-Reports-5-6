import { createHash, randomBytes } from "node:crypto"

/**
 * ICS calendar-feed token helpers (pure; unit-tested).
 *
 * The plaintext token is the bearer credential inside the personal
 * /api/schedule-ics/<token> URL. Since migration 278 the DB stores only its
 * SHA-256 (`schedule_ics_tokens.token_hash`), so a database read can never
 * reveal a usable feed URL — the plaintext exists exactly twice: in the URL
 * the employee saved into their calendar app, and transiently in the action
 * result the moment the link is created or rotated.
 *
 * SHA-256 (not bcrypt/scrypt) is deliberate: lookups need a deterministic
 * digest to match on, and the input is 24 CSPRNG bytes — far beyond
 * brute-force range — so a work factor adds cost without adding safety.
 */

/** 48 hex chars (24 random bytes) — comfortably over the DB's 32-char floor. */
export function newIcsToken(): string {
  return randomBytes(24).toString("hex")
}

/** Deterministic digest stored in (and matched against) `token_hash`. */
export function hashIcsToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}
