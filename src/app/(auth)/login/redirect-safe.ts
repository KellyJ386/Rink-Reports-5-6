// Pure, dependency-free validation for the post-login `redirectTo` param.
// Kept out of the "use server" action file so it can be unit-tested in the
// plain-Node vitest environment (see the scoping note in CLAUDE.md).

/**
 * Returns a safe same-origin, path-only redirect target, or null if the input
 * is unsafe. Guards against open redirects: the value must be an absolute path
 * on this origin.
 *
 * Accepts only strings that:
 *   - start with a single "/" (absolute path)
 *   - are NOT protocol-relative ("//host" or "/\host", which browsers treat as
 *     a scheme-relative URL to another origin)
 *   - contain no scheme (e.g. "javascript:", "http:", "data:")
 *   - contain no control/whitespace characters that could smuggle a scheme
 *
 * The returned value preserves any query string / fragment.
 */
export function isSafeRedirectPath(value: unknown): string | null {
  if (typeof value !== "string") return null
  const path = value.trim()
  if (path === "") return null

  // Must be an absolute path.
  if (!path.startsWith("/")) return null

  // Reject protocol-relative URLs: "//evil.com" and the backslash variant
  // "/\evil.com" (some browsers normalise "\" to "/").
  if (path.startsWith("//") || path.startsWith("/\\")) return null

  // Reject any control character or whitespace (0x00-0x20) that could be used
  // to smuggle or obscure a scheme (e.g. a tab before "javascript:").
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020]/.test(path)) return null

  // Reject any embedded scheme (e.g. a smuggled "javascript:" / "http:").
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null

  return path
}
