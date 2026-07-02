import { describe, expect, it } from "vitest"

import { buildIcsCalendar, icsEscape, icsUtc } from "./ics"

describe("icsUtc", () => {
  it("formats UTC basic form with zero-padding", () => {
    expect(icsUtc(new Date("2026-07-02T14:00:00.000Z"))).toBe("20260702T140000Z")
    expect(icsUtc(new Date("2026-01-05T03:07:09.000Z"))).toBe("20260105T030709Z")
  })
})

describe("icsEscape", () => {
  it("escapes backslash, semicolon, comma, and newlines", () => {
    expect(icsEscape("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne")
    expect(icsEscape("crlf\r\nhere")).toBe("crlf\\nhere")
  })
})

describe("buildIcsCalendar", () => {
  const now = new Date("2026-07-01T00:00:00.000Z")

  it("emits a well-formed calendar with CRLF endings", () => {
    const ics = buildIcsCalendar({
      calendarName: "My Shifts",
      now,
      events: [
        {
          uid: "shift-1@rink-reports",
          start: new Date("2026-07-02T14:00:00.000Z"),
          end: new Date("2026-07-02T22:00:00.000Z"),
          summary: "Shift — Zamboni",
          description: "Rink A",
        },
      ],
    })
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true)
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true)
    expect(ics).toContain("X-WR-CALNAME:My Shifts")
    expect(ics).toContain("UID:shift-1@rink-reports")
    expect(ics).toContain("DTSTART:20260702T140000Z")
    expect(ics).toContain("DTEND:20260702T220000Z")
    expect(ics).toContain("DTSTAMP:20260701T000000Z")
    expect(ics).toContain("SUMMARY:Shift — Zamboni")
    // Every line ends with CRLF (no bare \n).
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n")
  })

  it("escapes text fields", () => {
    const ics = buildIcsCalendar({
      calendarName: "A;B",
      now,
      events: [
        {
          uid: "u1",
          start: now,
          end: now,
          summary: "Front desk, evening; late",
        },
      ],
    })
    expect(ics).toContain("X-WR-CALNAME:A\\;B")
    expect(ics).toContain("SUMMARY:Front desk\\, evening\\; late")
  })

  it("folds long lines at 75 octets with a leading space", () => {
    const long = "x".repeat(200)
    const ics = buildIcsCalendar({
      calendarName: "Cal",
      now,
      events: [{ uid: "u1", start: now, end: now, summary: long }],
    })
    for (const line of ics.split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(75)
    }
    expect(ics).toContain("\r\n x")
  })

  it("renders an empty calendar without events", () => {
    const ics = buildIcsCalendar({ calendarName: "Empty", now, events: [] })
    expect(ics).toContain("BEGIN:VCALENDAR")
    expect(ics).not.toContain("BEGIN:VEVENT")
  })
})
