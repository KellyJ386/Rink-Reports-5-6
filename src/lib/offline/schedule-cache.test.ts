import { describe, expect, it } from "vitest"

import { isFresh, shiftsInWindow, type CachedShift } from "./schedule-cache"

describe("isFresh", () => {
  const now = 1_000_000_000_000

  it("is true within the ttl and false past it", () => {
    const ttl = 1000
    expect(isFresh(now - 500, ttl, now)).toBe(true)
    expect(isFresh(now - 1500, ttl, now)).toBe(false)
  })

  it("treats exactly-ttl-old as stale (strict <)", () => {
    expect(isFresh(now - 1000, 1000, now)).toBe(false)
  })
})

describe("shiftsInWindow", () => {
  const mk = (id: string, iso: string): CachedShift => ({
    id,
    starts_at: iso,
    ends_at: iso,
    role_label: null,
    status: "published",
    department_id: null,
    departments: null,
  })
  const from = new Date("2026-07-01T00:00:00Z").getTime()
  const to = new Date("2026-07-31T23:59:59Z").getTime()

  it("keeps in-window shifts and drops out-of-window ones", () => {
    const shifts = [
      mk("before", "2026-06-15T10:00:00Z"),
      mk("in1", "2026-07-10T10:00:00Z"),
      mk("after", "2026-08-05T10:00:00Z"),
      mk("in2", "2026-07-02T08:00:00Z"),
    ]
    const result = shiftsInWindow(shifts, from, to).map((s) => s.id)
    expect(result).toEqual(["in2", "in1"]) // filtered + sorted ascending
  })

  it("drops shifts with an unparseable date and returns [] for none", () => {
    expect(shiftsInWindow([mk("bad", "not-a-date")], from, to)).toEqual([])
    expect(shiftsInWindow([], from, to)).toEqual([])
  })
})
