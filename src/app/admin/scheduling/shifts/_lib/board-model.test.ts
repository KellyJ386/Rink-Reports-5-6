import { describe, expect, it } from "vitest"

import { dtoToEvent, monthGridRange } from "./board-model"

describe("monthGridRange", () => {
  it("spans whole weeks around July 2026 with a Sunday start", () => {
    // July 2026: the 1st is a Wednesday, the 31st a Friday. Sunday-start grid
    // runs Jun 28 – Aug 1 (35 days, 5 rows).
    const r = monthGridRange(new Date(2026, 6, 15), 0)
    expect(r.start).toEqual(new Date(2026, 5, 28))
    expect(r.dayCount).toBe(35)
    expect(r.end).toEqual(new Date(2026, 7, 2))
  })

  it("honors a Monday week start", () => {
    // Monday-start grid for July 2026 runs Jun 29 – Aug 2 (35 days).
    const r = monthGridRange(new Date(2026, 6, 15), 1)
    expect(r.start).toEqual(new Date(2026, 5, 29))
    expect(r.dayCount).toBe(35)
  })

  it("produces a 6-row grid when the month needs one", () => {
    // August 2026: the 1st is a Saturday — Sunday-start grid needs 6 rows
    // (Jul 26 – Sep 5, 42 days).
    const r = monthGridRange(new Date(2026, 7, 10), 0)
    expect(r.start).toEqual(new Date(2026, 6, 26))
    expect(r.dayCount).toBe(42)
  })

  it("produces a 4-row grid for a perfectly aligned February", () => {
    // February 2026 has 28 days and starts on a Sunday — a Sunday-start grid
    // is exactly 4 rows with no leading/trailing days.
    const r = monthGridRange(new Date(2026, 1, 14), 0)
    expect(r.start).toEqual(new Date(2026, 1, 1))
    expect(r.dayCount).toBe(28)
  })
})

describe("dtoToEvent", () => {
  const dto = {
    id: "s1",
    starts_at: "2026-01-15T14:00:00.000Z",
    ends_at: "2026-01-15T22:00:00.000Z",
    employee_id: "e1",
    job_area_id: null,
    department_id: null,
    status: "draft" as const,
    break_minutes: 30,
    role_label: null,
    notes: null,
    recurring_parent_id: null,
  }

  it("projects the stored instants into the facility's timezone", () => {
    // 14:00Z is 09:00 in New York — that is what the grid must place at row 9,
    // regardless of where the admin's browser is.
    const ev = dtoToEvent(dto, "America/New_York")
    expect(ev.start.getHours()).toBe(9)
    expect(ev.end.getHours()).toBe(17)
    expect(ev.start.getDate()).toBe(15)
  })

  it("uses the facility calendar day for a late-evening shift", () => {
    // 02:00Z on the 16th is still 21:00 on the 15th at the rink, so the block
    // belongs in Thursday's column, not Friday's.
    const ev = dtoToEvent(
      { ...dto, starts_at: "2026-01-16T02:00:00.000Z", ends_at: "2026-01-16T05:00:00.000Z" },
      "America/New_York"
    )
    expect(ev.start.getDate()).toBe(15)
    expect(ev.start.getHours()).toBe(21)
  })

  it("falls back to browser-local when no timezone is configured", () => {
    const ev = dtoToEvent(dto, null)
    expect(ev.start.getTime()).toBe(new Date(dto.starts_at).getTime())
    expect(ev.end.getTime()).toBe(new Date(dto.ends_at).getTime())
  })

  it("carries the non-temporal fields through unchanged", () => {
    const ev = dtoToEvent(dto, "America/New_York")
    expect(ev.id).toBe("s1")
    expect(ev.employeeId).toBe("e1")
    expect(ev.breakMinutes).toBe(30)
    expect(ev.status).toBe("draft")
  })
})
