/**
 * Shared helper for turning a Supabase / Postgres error into a friendly,
 * user-facing message. Pure string logic — no side effects, no server-only
 * deps — so it is safe to import from server actions and unit tests alike.
 *
 * Behavior (superset of the copy-pasted variants it replaced):
 *   - null / undefined error        → `fallback`
 *   - 23505 (unique_violation)       → generic "duplicate" copy
 *   - 23503 (foreign_key_violation)  → generic "related record" copy
 *   - P0001 (raise_exception)        → the DB message, else `fallback`
 *   - anything else                  → the DB message, else `fallback`
 *
 * Call sites that need bespoke per-code copy (custom duplicate/FK strings,
 * extra codes like 23P01, or message-pattern matching) keep their own local
 * helper rather than routing through this one.
 */
export type SupabaseError = { code?: string; message?: string } | null

export function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  if (err.code === "23505") {
    return "That value conflicts with an existing record (duplicate)."
  }
  if (err.code === "23503") {
    return "Cannot complete: a related record prevents this change."
  }
  if (err.code === "P0001") {
    return err.message?.trim() || fallback
  }
  return err.message?.trim() || fallback
}
