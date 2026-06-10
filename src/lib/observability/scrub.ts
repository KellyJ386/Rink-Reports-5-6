// Pure PII scrubbing for error/telemetry payloads. Incident descriptions,
// accident records, and employee contact details can end up inside thrown
// error messages (e.g. Postgres constraint details echoing row values), so
// anything we log or ship to PostHog goes through here first. Dependency-free
// and shared by the server logger (log-server-error.ts) and the client
// PostHog wiring (posthog-provider / capture-client) — see scrub.test.ts.

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g

// US-style phone numbers (optionally +1, separators, parens). The lookarounds
// keep us from mangling UUIDs / timestamps embedded in error messages.
const PHONE_RE =
  /(?<![\dA-Za-z-])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]?\d{4}(?![\dA-Za-z-])/g

export const SCRUB_MAX_LENGTH = 500

/** Mask emails/phones and truncate. Never throws; non-strings become "". */
export function scrubText(text: unknown, maxLength = SCRUB_MAX_LENGTH): string {
  if (typeof text !== "string") return ""
  const masked = text
    .replace(EMAIL_RE, "[email]")
    .replace(PHONE_RE, "[phone]")
  return masked.length > maxLength ? `${masked.slice(0, maxLength)}…` : masked
}

export type ScrubbedError = {
  name: string
  message: string
  /** Postgres error code / Next.js digest when present, for correlation. */
  code: string | null
  digest: string | null
}

/** Normalize an unknown thrown value into a scrubbed, loggable shape. */
export function scrubError(err: unknown): ScrubbedError {
  if (err instanceof Error) {
    const anyErr = err as Error & { code?: unknown; digest?: unknown }
    return {
      name: err.name || "Error",
      message: scrubText(err.message),
      code: typeof anyErr.code === "string" ? anyErr.code : null,
      digest: typeof anyErr.digest === "string" ? anyErr.digest : null,
    }
  }
  if (typeof err === "object" && err !== null) {
    const obj = err as { message?: unknown; code?: unknown }
    return {
      name: "NonError",
      message: scrubText(
        typeof obj.message === "string" ? obj.message : JSON.stringify(err),
      ),
      code: typeof obj.code === "string" ? obj.code : null,
      digest: null,
    }
  }
  return { name: "NonError", message: scrubText(String(err)), code: null, digest: null }
}
