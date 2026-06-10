// Server-side error capture (O2 from the 360 review). Server actions return
// `{ error }` to the form — fine for the user, invisible to ops. Every catch
// block also calls this, so failure context lands in the function logs as one
// structured, PII-scrubbed line, and (in production, when configured) as a
// PostHog `server_error` event.
//
// Fire-and-forget by design: never throws, never blocks the response.

import "server-only"

import { posthogGate } from "./gate"
import { scrubError, scrubText } from "./scrub"

export function logServerError(
  context: string,
  err: unknown,
  extra?: Record<string, string | number | boolean | null>,
): void {
  const scrubbed = scrubError(err)
  const entry = {
    kind: "server_error",
    context,
    ...scrubbed,
    ...(extra ? { extra } : {}),
    ts: new Date().toISOString(),
  }
  console.error("[server-error]", JSON.stringify(entry))

  const gate = posthogGate({
    key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    explicit: process.env.NEXT_PUBLIC_POSTHOG_ENABLED,
    vercelEnv: process.env.VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
  })
  if (!gate.enabled) return

  const host =
    process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || "https://us.i.posthog.com"
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  void fetch(`${host.replace(/\/$/, "")}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
      event: "server_error",
      distinct_id: "server",
      properties: {
        context,
        error_name: scrubbed.name,
        error_message: scrubText(scrubbed.message),
        error_code: scrubbed.code,
        digest: scrubbed.digest,
      },
    }),
    signal: controller.signal,
  })
    .catch(() => {})
    .finally(() => clearTimeout(timer))
}
