import { describe, expect, it } from "vitest"

import {
  hhmmToMinute,
  minuteToLabel,
  validateBookingRequest,
} from "./booking-request"

const TODAY = "2026-08-28"

function raw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requesterName: "Jordan Vaughn",
    requesterEmail: "jordan@club.example",
    requesterPhone: "(315) 555-0100",
    organization: "SU Club Hockey",
    rinkId: "a5000001-0000-4000-8000-000000000001",
    requestedDate: "2026-09-12",
    startMinute: 1020,
    endMinute: 1110,
    purpose: "Weekly practice slot",
    ...over,
  }
}

describe("validateBookingRequest", () => {
  it("accepts a complete request and trims text", () => {
    const r = validateBookingRequest(raw({ requesterName: "  Jordan  " }), TODAY)
    expect(r).toMatchObject({ ok: true })
    if (r.ok) {
      expect(r.value.requesterName).toBe("Jordan")
      expect(r.value.startMinute).toBe(1020)
    }
  })

  it("optional fields may be blank and normalize to null", () => {
    const r = validateBookingRequest(
      raw({ requesterPhone: "  ", organization: undefined, purpose: null, rinkId: "" }),
      TODAY,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.requesterPhone).toBeNull()
      expect(r.value.organization).toBeNull()
      expect(r.value.purpose).toBeNull()
      expect(r.value.rinkId).toBeNull()
    }
  })

  it("refuses missing name, bad email, junk rink id", () => {
    expect(validateBookingRequest(raw({ requesterName: "" }), TODAY).ok).toBe(false)
    expect(validateBookingRequest(raw({ requesterEmail: "nope" }), TODAY).ok).toBe(false)
    expect(validateBookingRequest(raw({ rinkId: "DROP TABLE" }), TODAY).ok).toBe(false)
  })

  it("refuses the past, allows today, caps the horizon at two years", () => {
    expect(validateBookingRequest(raw({ requestedDate: "2026-08-27" }), TODAY).ok).toBe(false)
    expect(validateBookingRequest(raw({ requestedDate: TODAY }), TODAY).ok).toBe(true)
    expect(validateBookingRequest(raw({ requestedDate: "2028-08-27" }), TODAY).ok).toBe(true)
    expect(validateBookingRequest(raw({ requestedDate: "2028-08-29" }), TODAY).ok).toBe(false)
  })

  it("windows: end after start, minimum 30 minutes, past-midnight end allowed to 1680", () => {
    expect(validateBookingRequest(raw({ startMinute: 600, endMinute: 600 }), TODAY).ok).toBe(false)
    expect(validateBookingRequest(raw({ startMinute: 600, endMinute: 615 }), TODAY).ok).toBe(false)
    expect(validateBookingRequest(raw({ startMinute: 1380, endMinute: 1500 }), TODAY).ok).toBe(true)
    expect(validateBookingRequest(raw({ startMinute: 1380, endMinute: 1700 }), TODAY).ok).toBe(false)
    expect(validateBookingRequest(raw({ startMinute: 10.5, endMinute: 60 }), TODAY).ok).toBe(false)
  })

  it("enforces the same length caps as the table's CHECKs", () => {
    expect(validateBookingRequest(raw({ purpose: "x".repeat(2001) }), TODAY).ok).toBe(false)
    expect(validateBookingRequest(raw({ organization: "x".repeat(161) }), TODAY).ok).toBe(false)
    expect(validateBookingRequest(raw({ requesterName: "x".repeat(121) }), TODAY).ok).toBe(false)
  })
})

describe("hhmmToMinute", () => {
  it("parses wall times and rejects junk", () => {
    expect(hhmmToMinute("00:00")).toBe(0)
    expect(hhmmToMinute("17:30")).toBe(1050)
    expect(hhmmToMinute("23:59")).toBe(1439)
    expect(hhmmToMinute("24:00")).toBeNull()
    expect(hhmmToMinute("7:5")).toBeNull()
    expect(hhmmToMinute("noon")).toBeNull()
  })
})

describe("minuteToLabel", () => {
  it("renders 12-hour labels, wrapping past midnight", () => {
    expect(minuteToLabel(0)).toBe("12:00 AM")
    expect(minuteToLabel(720)).toBe("12:00 PM")
    expect(minuteToLabel(1050)).toBe("5:30 PM")
    expect(minuteToLabel(1470)).toBe("12:30 AM") // 24:30 = next-day 00:30
  })
})
