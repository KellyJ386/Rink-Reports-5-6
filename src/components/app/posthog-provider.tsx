"use client"

import { useEffect } from "react"

import { clientPosthogEnabled } from "@/lib/observability/capture-client"
import { scrubText } from "@/lib/observability/scrub"

/**
 * PostHog client integration. Capture is environment-gated (see
 * src/lib/observability/gate.ts): it requires NEXT_PUBLIC_POSTHOG_KEY AND
 * (production OR an explicit NEXT_PUBLIC_POSTHOG_ENABLED=true), so a dev
 * clone or preview deployment that inherits the production key never
 * pollutes production analytics. When the gate is closed the dynamic import
 * never fires — posthog-js stays out of the JS heap entirely.
 *
 * `autocapture` is intentionally OFF because for a staff app the
 * noise/utility ratio of capturing every click + input is poor, and there
 * are privacy concerns about autocapture grabbing values from forms that
 * handle PII (incident descriptions, employee names, accident records).
 * Defense-in-depth for the same concern: `before_send` runs every event's
 * exception/message-ish properties through the shared PII scrubber.
 *
 * Error tracking is wired separately via captureClientException (used by
 * error.tsx / global-error.tsx / segment-error.tsx), which applies the same
 * gate before importing posthog-js.
 */
export function PostHogProvider() {
  useEffect(() => {
    if (!clientPosthogEnabled()) return
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY as string
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
        // until a user signs in.
        persistence: "memory",
        before_send: (event) => {
          if (!event) return event
          const props = event.properties as
            | Record<string, unknown>
            | undefined
          if (!props) return event
          // Exception events: scrub message/value fields, which can echo
          // form contents (incident text, names, emails) from thrown errors.
          if (typeof props.$exception_message === "string") {
            props.$exception_message = scrubText(props.$exception_message)
          }
          const list = props.$exception_list
          if (Array.isArray(list)) {
            for (const item of list) {
              if (item && typeof item === "object") {
                const entry = item as { value?: unknown }
                if (typeof entry.value === "string") {
                  entry.value = scrubText(entry.value)
                }
              }
            }
          }
          return event
        },
      })
    })
    return () => {
      cancelled = true
    }
  }, [])
  return null
}
