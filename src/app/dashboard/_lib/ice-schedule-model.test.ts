import { describe, expect, it } from "vitest"

import { buildRinkSchedules, nextUpcomingResurface, type ReadOnlyBooking } from "./ice-schedule-model"

const NOW = "2026-08-29T15:00:00.000Z"

function booking(overrides: Partial<ReadOnlyBooking>): ReadOnlyBooking {
  return {
    id: "b1",
    rinkId: "rink-a",
    startMinute: 600,
    endMinute: 660,
    startsAtIso: "2026-08-29T16:00:00.000Z",
    label: "Public skate",
    typeColor: "#4DFF00",
    tentative: false,
    isResurface: false,
    resurfaceStatus: null,
    ...overrides,
  }
}

describe("nextUpcomingResurface", () => {
  it("picks the earliest still-scheduled resurface after now", () => {
    const bookings = [
      booking({ id: "late", startsAtIso: "2026-08-29T20:00:00.000Z", isResurface: true, resurfaceStatus: "scheduled" }),
      booking({ id: "early", startsAtIso: "2026-08-29T17:00:00.000Z", isResurface: true, resurfaceStatus: "scheduled" }),
    ]
    expect(nextUpcomingResurface(bookings, NOW)?.id).toBe("early")
  })

  it("ignores non-resurface bookings", () => {
    const bookings = [booking({ startsAtIso: "2026-08-29T17:00:00.000Z", isResurface: false })]
    expect(nextUpcomingResurface(bookings, NOW)).toBeNull()
  })

  it("ignores resurfaces that already resolved (completed or skipped)", () => {
    const bookings = [
      booking({ id: "done", startsAtIso: "2026-08-29T17:00:00.000Z", isResurface: true, resurfaceStatus: "completed" }),
      booking({ id: "skipped", startsAtIso: "2026-08-29T18:00:00.000Z", isResurface: true, resurfaceStatus: "skipped" }),
    ]
    expect(nextUpcomingResurface(bookings, NOW)).toBeNull()
  })

  it("ignores a scheduled resurface that already started (today-remaining only)", () => {
    const bookings = [
      booking({ id: "past", startsAtIso: "2026-08-29T14:00:00.000Z", isResurface: true, resurfaceStatus: "scheduled" }),
    ]
    expect(nextUpcomingResurface(bookings, NOW)).toBeNull()
  })

  it("returns null for an empty list", () => {
    expect(nextUpcomingResurface([], NOW)).toBeNull()
  })
})

describe("buildRinkSchedules", () => {
  const rinks = [
    { id: "rink-a", name: "Rink A", shortCode: "A", color: "#4DFF00" },
    { id: "rink-b", name: "Rink B", shortCode: "B", color: "#002244" },
  ]

  it("groups bookings by rink, sorted by start time", () => {
    const bookings = [
      booking({ id: "later", rinkId: "rink-a", startMinute: 900 }),
      booking({ id: "earlier", rinkId: "rink-a", startMinute: 600 }),
      booking({ id: "b-rink", rinkId: "rink-b", startMinute: 700 }),
    ]
    const schedules = buildRinkSchedules(rinks, bookings, NOW)
    expect(schedules).toHaveLength(2)
    expect(schedules[0].bookings.map((b) => b.id)).toEqual(["earlier", "later"])
    expect(schedules[1].bookings.map((b) => b.id)).toEqual(["b-rink"])
  })

  it("includes a rink with no bookings today", () => {
    const schedules = buildRinkSchedules(rinks, [], NOW)
    expect(schedules).toHaveLength(2)
    expect(schedules[0].bookings).toEqual([])
    expect(schedules[0].nextResurface).toBeNull()
  })

  it("attaches each rink's own next resurface independently", () => {
    const bookings = [
      booking({
        id: "a-cut",
        rinkId: "rink-a",
        startsAtIso: "2026-08-29T17:00:00.000Z",
        isResurface: true,
        resurfaceStatus: "scheduled",
      }),
      booking({
        id: "b-cut",
        rinkId: "rink-b",
        startsAtIso: "2026-08-29T18:00:00.000Z",
        isResurface: true,
        resurfaceStatus: "scheduled",
      }),
    ]
    const schedules = buildRinkSchedules(rinks, bookings, NOW)
    expect(schedules[0].nextResurface?.id).toBe("a-cut")
    expect(schedules[1].nextResurface?.id).toBe("b-cut")
  })
})
