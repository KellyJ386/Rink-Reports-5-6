import { describe, expect, it } from "vitest"

import { agingBucket, daysBetweenKeys, decideReminder } from "./overdue"

describe("daysBetweenKeys", () => {
  it("counts whole days forward and backward", () => {
    expect(daysBetweenKeys("2026-08-01", "2026-08-28")).toBe(27)
    expect(daysBetweenKeys("2026-08-28", "2026-08-01")).toBe(-27)
    expect(daysBetweenKeys("2026-08-28", "2026-08-28")).toBe(0)
  })

  it("crosses months, years, and DST transitions without drift", () => {
    expect(daysBetweenKeys("2025-12-31", "2026-01-01")).toBe(1)
    expect(daysBetweenKeys("2026-02-28", "2026-03-01")).toBe(1) // not a leap year
    // US spring-forward (Mar 8 2026) — a wall-clock hour vanishes; the day
    // count must not.
    expect(daysBetweenKeys("2026-03-07", "2026-03-09")).toBe(2)
  })

  it("treats malformed keys as zero distance rather than throwing", () => {
    expect(daysBetweenKeys("garbage", "2026-08-28")).toBe(0)
    expect(daysBetweenKeys("2026-08-28", "")).toBe(0)
  })
})

describe("agingBucket", () => {
  it("buckets on the standard AR boundaries", () => {
    expect(agingBucket(1)).toBe("1-30")
    expect(agingBucket(30)).toBe("1-30")
    expect(agingBucket(31)).toBe("31-60")
    expect(agingBucket(60)).toBe("31-60")
    expect(agingBucket(61)).toBe("61-90")
    expect(agingBucket(90)).toBe("61-90")
    expect(agingBucket(91)).toBe("90+")
  })
})

describe("decideReminder", () => {
  const base = { todayKey: "2026-08-28", nowMs: Date.parse("2026-08-28T14:00:00Z"), cadenceDays: 7 }

  it("reminds an open invoice past due that was never reminded", () => {
    expect(
      decideReminder(
        { status: "sent", dueDate: "2026-08-20", lastReminderAt: null },
        base,
      ),
    ).toEqual({ due: true, daysOverdue: 8 })
  })

  it("partially paid still owes and still reminds", () => {
    expect(
      decideReminder(
        { status: "partially_paid", dueDate: "2026-07-01", lastReminderAt: null },
        base,
      ),
    ).toEqual({ due: true, daysOverdue: 58 })
  })

  it("draft, paid, and void never remind", () => {
    for (const status of ["draft", "paid", "void"]) {
      expect(
        decideReminder({ status, dueDate: "2026-01-01", lastReminderAt: null }, base),
      ).toEqual({ due: false, reason: "not_open" })
    }
  })

  it("due today is not overdue; due yesterday is", () => {
    expect(
      decideReminder(
        { status: "sent", dueDate: "2026-08-28", lastReminderAt: null },
        base,
      ),
    ).toEqual({ due: false, reason: "not_overdue" })
    expect(
      decideReminder(
        { status: "sent", dueDate: "2026-08-27", lastReminderAt: null },
        base,
      ),
    ).toEqual({ due: true, daysOverdue: 1 })
  })

  it("respects the cadence measured from the last reminder", () => {
    const candidate = { status: "sent", dueDate: "2026-08-01", lastReminderAt: "2026-08-25T09:00:00Z" }
    expect(decideReminder(candidate, base)).toEqual({ due: false, reason: "too_soon" })
    // 7 full days later it fires again.
    expect(
      decideReminder(candidate, { ...base, nowMs: Date.parse("2026-09-01T09:00:00Z") }),
    ).toEqual({ due: true, daysOverdue: 27 })
  })

  it("an unparseable lastReminderAt fails open (reminds) rather than sticking forever", () => {
    expect(
      decideReminder(
        { status: "sent", dueDate: "2026-08-01", lastReminderAt: "not-a-date" },
        base,
      ),
    ).toEqual({ due: true, daysOverdue: 27 })
  })
})
