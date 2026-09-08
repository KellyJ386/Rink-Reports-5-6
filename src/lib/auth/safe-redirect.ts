// Pure, dependency-free validation for user-supplied redirect targets: the
// post-login `redirectTo` param and the email-callback `next` param. Kept out
// of the "use server" files so it can be unit-tested in the plain-Node vitest
// environment (see the scoping note in CLAUDE.md). Import this module
// directly, not via `@/lib/auth` (whose index pulls in server-only guards).

// A fixed, unroutable base used only to ask the WHATWG parser "would this
// value leave the current origin?". It is never the redirect destination.
const VALIDATION_BASE = new URL("https://redirect-validation.invalid/")

/**
 * Returns a safe same-origin, path-only redirect target, or null if the input
 * is unsafe. Guards against open redirects: the value must be an absolute path
 * on this origin.
 *
 * Accepts only strings that:
 *   - start with a single "/" (absolute path)
 *   - are NOT protocol-relative ("//host" or "/\host", which browsers treat as
 *     a scheme-relative URL to another origin)
 *   - contain no backslash anywhere (WHATWG treats "\" as "/" for special
 *     schemes, so it is rejected outright rather than normalised)
 *   - contain no control/whitespace characters that could smuggle a scheme
 *   - contain no scheme (e.g. "javascript:", "http:", "data:")
 *   - still resolve to the same origin when parsed by the WHATWG URL parser
 *     (defense in depth over the syntactic checks above)
 *
 * The returned value preserves any query string / fragment.
 */
export function safeRedirectPath(value: unknown): string | null {
  if (typeof value !== "string") return null
  const path = value.trim()
  if (path === "") return null

  // Must be an absolute path.
  if (!path.startsWith("/")) return null

  // Reject protocol-relative URLs: "//evil.com" and the backslash variant
  // "/\evil.com" (browsers normalise "\" to "/"). Any other backslash is
  // rejected too rather than normalised.
  if (path.startsWith("//") || path.includes("\\")) return null

  // Reject any control character or whitespace (0x00-0x20) that could be used
  // to smuggle or obscure a scheme (e.g. a tab before "javascript:"). The URL
  // parser strips tab/CR/LF before parsing, so "/\t/evil.com" would otherwise
  // become "//evil.com".
  if (/[\u0000-\u0020]/.test(path)) return null

  // Reject any embedded scheme (e.g. a smuggled "javascript:" / "http:").
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null

  // Final check: resolve against a fixed base and require the origin to be
  // unchanged. This is what `NextResponse.redirect(new URL(path, request.url))`
  // will do, so it is the authoritative answer to "does this stay on-site?".
  try {
    if (new URL(path, VALIDATION_BASE).origin !== VALIDATION_BASE.origin) {
      return null
    }
  } catch {
    return null
  }

  return path
}
