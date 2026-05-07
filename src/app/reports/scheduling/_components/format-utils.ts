/**
 * Shared formatting helpers for the staff scheduling UI.
 * Server-safe (no client-only globals).
 */

export function formatDateTime(
  iso: string,
  timezone: string | null
): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: timezone || undefined,
      dateStyle: "medium",
      timeStyle: "short",
    })
  } catch {
    return new Date(iso).toLocaleString()
  }
}

export function formatDate(iso: string, timezone: string | null): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      timeZone: timezone || undefined,
      weekday: "short",
      month: "short",
      day: "numeric",
    })
  } catch {
    return new Date(iso).toLocaleDateString()
  }
}

export function formatTime(iso: string, timezone: string | null): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      timeZone: timezone || undefined,
      hour: "numeric",
      minute: "2-digit",
    })
  } catch {
    return new Date(iso).toLocaleTimeString()
  }
}

export function formatDateRange(
  startIso: string,
  endIso: string,
  timezone: string | null
): string {
  return `${formatDate(startIso, timezone)} ${formatTime(startIso, timezone)} – ${formatTime(endIso, timezone)}`
}

export function formatTimeOnly(value: string): string {
  // value is "HH:MM:SS" or "HH:MM"
  const m = value.match(/^(\d{2}):(\d{2})/)
  if (!m) return value
  const h = Number(m[1])
  const mm = m[2]
  const period = h >= 12 ? "PM" : "AM"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${mm} ${period}`
}

export function formatRelativeAge(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffMs = now - then
  const diffMin = Math.round(diffMs / 60000)
  if (diffMin < 1) return "just now"
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  return new Date(iso).toLocaleDateString()
}
