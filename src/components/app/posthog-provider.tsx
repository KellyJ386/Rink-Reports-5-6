"use client"

import { useEffect } from "react"

/**
 * PostHog client integration. Two modes:
 *
 *  - NEXT_PUBLIC_POSTHOG_KEY unset (dev / local / unconfigured deploy):
 *    the dynamic import never fires, posthog-js never enters the page's
 *    JS heap, and no requests go out. Net cost: zero.
 *
 *  - NEXT_PUBLIC_POSTHOG_KEY set: lazy-import posthog-js after hydration,
 *    initialize with pageview tracking on. `autocapture` is intentionally
 *    OFF because for a staff app the noise/utility ratio of capturing
 *    every click + input is poor, and there are privacy concerns about
 *    autocapture grabbing values from forms that handle PII (incident
 *    descriptions, employee names, accident records). Call sites that
 *    want manual capture import posthog-js directly.
 *
 * Error tracking is wired separately in src/app/error.tsx and
 * src/app/global-error.tsx — they import posthog-js dynamically inside
 * a useEffect and call captureException so an error during init doesn't
 * itself crash the boundary.
 */
export function PostHogProvider() {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
    if (!key) return
    const host =
      process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || "https://us.i.posthog.com"
    let cancelled = false
    void import("posthog-js").then(({ default: posthog }) => {
      if (cancelled) return
      posthog.init(key, {
        api_host: host,
        capture_pageview: true,
        autocapture: false,
        // Staff app, no anonymous traffic — disable persisted distinct_id
        // until a user signs in. The user-identify call happens in
        // identify-on-login (future commit) once the auth context is wired.
        persistence: "memory",
      })
    })
    return () => {
      cancelled = true
    }
  }, [])
  return null
}
