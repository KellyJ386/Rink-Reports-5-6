"use client"

// Shared recovery UI for segment-level error.tsx boundaries (/admin,
// /admin/scheduling, /reports). Keeps the shell + nav alive (unlike the
// root boundary) and offers retry + an escape hatch back to the section
// home. Mirrors the root boundary's PostHog capture.

import { useEffect } from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"

export function SegmentError({
  error,
  reset,
  title,
  homeHref,
  homeLabel,
}: {
  error: Error & { digest?: string }
  reset: () => void
  title: string
  homeHref: string
  homeLabel: string
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
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="text-muted-foreground max-w-md text-sm">
        The error has been logged. You can retry, or head back and try a
        different page.
      </p>
      {error.digest ? (
        <p className="text-muted-foreground font-mono text-xs">
          Reference: {error.digest}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" asChild>
          <Link href={homeHref}>{homeLabel}</Link>
        </Button>
      </div>
    </div>
  )
}
