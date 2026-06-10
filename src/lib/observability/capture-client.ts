// Client-side exception capture used by the error boundaries. Applies the
// same environment gate as the PostHogProvider (so dev clones / previews
// that inherit a production key never ship events) and lazy-imports
// posthog-js so a failed analytics load can't break the boundary itself.
// Scrubbing happens centrally in the provider's before_send hook.

import { posthogGate } from "./gate"

export function clientPosthogEnabled(): boolean {
  return posthogGate({
    key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    explicit: process.env.NEXT_PUBLIC_POSTHOG_ENABLED,
    vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
  }).enabled
}

export function captureClientException(
  error: Error & { digest?: string },
): void {
  if (!clientPosthogEnabled()) return
  void import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.captureException(error, { digest: error.digest })
    })
    .catch(() => {})
}
