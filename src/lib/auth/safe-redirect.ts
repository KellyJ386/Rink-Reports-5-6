const VALIDATION_BASE = new URL("https://redirect-validation.invalid/")

/**
 * Returns an origin-relative absolute path, or null when the value could make
 * the WHATWG URL parser leave the current origin.
 */
export function safeRedirectPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null

  // Reject instead of normalizing ambiguous input. Backslashes are especially
  // important: WHATWG treats them as slashes in special-scheme URLs.
  if (!value.startsWith("/") || /[\\\u0000-\u0020]/.test(value)) return null

  try {
    const resolved = new URL(value, VALIDATION_BASE)
    return resolved.origin === VALIDATION_BASE.origin ? value : null
  } catch {
    return null
  }
}
