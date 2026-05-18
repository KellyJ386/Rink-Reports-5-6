"use client"

import { useEffect } from "react"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
    // Forward to PostHog if configured. Dynamic import keeps posthog-js
    // out of the error boundary's critical render path — if posthog-js
    // itself fails to load (network, ad-blocker), the boundary still
    // works locally.
    if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
      void import("posthog-js")
        .then(({ default: posthog }) => {
          posthog.captureException(error, { digest: error.digest })
        })
        .catch(() => {})
    }
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground">
          Reference: {error.digest}
        </p>
      ) : null}
      <button
        onClick={reset}
        className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground"
      >
        Try again
      </button>
    </div>
  )
}
