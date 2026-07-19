"use client"

import { useSyncExternalStore } from "react"

// Renders a timestamp in the *browser's* locale/timezone without tripping React
// #418. On Vercel the server runs in UTC while users are in their own zone
// (e.g. America/New_York), so calling toLocaleString/Date/Time during SSR emits
// different text than the browser's first client render — a hydration mismatch.
// We show a stable placeholder on the server and through initial hydration, then
// swap to the local string after mount. This mirrors the null-server-snapshot
// trick the live clock in global-header.tsx uses: getServerSnapshot returns a
// value that renders the placeholder, and useSyncExternalStore re-renders with
// the client snapshot only after hydration completes.

type LocalDateTimeFormat = "datetime" | "date" | "time"

type LocalDateTimeProps = {
  iso: string | null | undefined
  format?: LocalDateTimeFormat
  options?: Intl.DateTimeFormatOptions
  /** Rendered before mount and for null / unparseable input. */
  placeholder?: string
  className?: string
}

function subscribe(): () => void {
  return () => {}
}
function getMountedSnapshot(): boolean {
  return true
}
function getServerSnapshot(): boolean {
  return false
}

/**
 * `false` during SSR and the first hydration render, `true` afterward. Uses the
 * same null-server-snapshot trick as LocalDateTime so gating on it never trips a
 * hydration mismatch. Use it to defer any browser-local value (e.g. a
 * datetime-local "now" default) until the client is in control.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getMountedSnapshot, getServerSnapshot)
}

function formatValue(
  iso: string,
  format: LocalDateTimeFormat,
  options: Intl.DateTimeFormatOptions | undefined,
): string {
  const d = new Date(iso)
  // Non-timestamp strings (e.g. a bare "HH:MM") stay as-is, matching the
  // try/catch fallbacks the per-page fmt helpers used before.
  if (Number.isNaN(d.getTime())) return iso
  switch (format) {
    case "date":
      return d.toLocaleDateString(undefined, options)
    case "time":
      return d.toLocaleTimeString(undefined, options)
    default:
      return d.toLocaleString(undefined, options)
  }
}

export function LocalDateTime({
  iso,
  format = "datetime",
  options,
  placeholder = "—",
  className,
}: LocalDateTimeProps) {
  const mounted = useSyncExternalStore(
    subscribe,
    getMountedSnapshot,
    getServerSnapshot,
  )
  const text = mounted && iso ? formatValue(iso, format, options) : placeholder
  return <span className={className}>{text}</span>
}
