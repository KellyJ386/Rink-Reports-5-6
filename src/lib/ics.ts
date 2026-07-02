// Minimal iCalendar (RFC 5545) generator for the schedule feed. Pure and
// dependency-free so it can be unit-tested (vitest runs in plain Node).

export type IcsEvent = {
  /** Globally unique, stable per shift (e.g. `${shiftId}@rink-reports`). */
  uid: string
  start: Date
  end: Date
  summary: string
  description?: string
  location?: string
}

/** "20260702T140000Z" — UTC basic format required by DTSTART/DTEND. */
export function icsUtc(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  )
}

/** Escape TEXT values per RFC 5545 §3.3.11 (backslash, ; , and newlines). */
export function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n")
}

/** Fold lines longer than 75 octets with CRLF + space (RFC 5545 §3.1). */
function fold(line: string): string {
  if (line.length <= 75) return line
  const parts: string[] = []
  let rest = line
  parts.push(rest.slice(0, 75))
  rest = rest.slice(75)
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`)
    rest = rest.slice(74)
  }
  if (rest.length > 0) parts.push(` ${rest}`)
  return parts.join("\r\n")
}

/**
 * Build a complete VCALENDAR document (CRLF line endings, folded lines).
 * `now` is injected so output is deterministic and testable.
 */
export function buildIcsCalendar(opts: {
  calendarName: string
  events: IcsEvent[]
  now?: Date
}): string {
  const dtstamp = icsUtc(opts.now ?? new Date())
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Rink Reports//Employee Scheduling//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(opts.calendarName)}`,
  ]
  for (const ev of opts.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${icsEscape(ev.uid)}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${icsUtc(ev.start)}`,
      `DTEND:${icsUtc(ev.end)}`,
      `SUMMARY:${icsEscape(ev.summary)}`
    )
    if (ev.description) {
      lines.push(`DESCRIPTION:${icsEscape(ev.description)}`)
    }
    if (ev.location) {
      lines.push(`LOCATION:${icsEscape(ev.location)}`)
    }
    lines.push("END:VEVENT")
  }
  lines.push("END:VCALENDAR")
  return lines.map(fold).join("\r\n") + "\r\n"
}
