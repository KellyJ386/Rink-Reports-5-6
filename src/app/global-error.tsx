"use client"

import { useEffect } from "react"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
    if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
      void import("posthog-js")
        .then(({ default: posthog }) => {
          posthog.captureException(error, { digest: error.digest })
        })
        .catch(() => {})
    }
  }, [error])

  return (
    <html>
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <h2 className="text-xl font-semibold">Something went wrong</h2>
        {error.digest ? (
          <p className="font-mono text-xs text-muted-foreground">
            Reference: {error.digest}
          </p>
        ) : null}
        <button
          onClick={reset}
          className="rounded bg-primary px-4 py-2 text-sm"
        >
          Try again
        </button>
      </body>
    </html>
  )
}
