// Pure fail-closed interpretation of the `current_user_has_permission` RPC
// result. Kept free of server-only imports so it can be unit-tested (see
// check-core.test.ts and the vitest scoping note in CLAUDE.md); the
// server-only wrapper (check.ts) consumes it.

export type PermissionRpcResult = {
  data: unknown
  error: unknown
}

/**
 * True only when the RPC returned exactly `true` with no error. Anything
 * else — an error, null, a non-boolean, even a truthy string — denies, so a
 * malformed or failed permission check can never grant access.
 */
export function permissionFromRpc({ data, error }: PermissionRpcResult): boolean {
  if (error) return false
  return data === true
}
