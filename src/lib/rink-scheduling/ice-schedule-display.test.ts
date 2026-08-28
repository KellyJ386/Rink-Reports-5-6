import { describe, expect, it } from "vitest"

import {
  buildIceScheduleBoard,
  publicSlotLabel,
  type ScheduleBookingRow,
  type ScheduleRinkRow,
} from "./ice-schedule-display"

const NOW = Date.parse("2026-08-28T20:00:00.000Z")

const RINKS: ScheduleRinkRow[] = [
  { id: "r2", name: "South Rink", color: null, sortOrder: 2 },
  { id: "r1", name: "North Rink", color: "#4DFF00", sortOrder: 1 },
]

function booking(over: Partial<ScheduleBookingRow>): ScheduleBookingRow {
  return {
    id: "b1",
    rinkId: "r1",
    startsAt: "2026-08-28T21:00:00.000Z",
    endsAt: "2026-08-28T22:00:00.000Z",
    status: "confirmed",
    title: null,
    typeName: "Public Skate",
    ...over,
  }
}

describe("publicSlotLabel", () => {
  it("title, then type, then a neutral word — never blank", () => {
    expect(publicSlotLabel("Championship warm-up", "Practice")).toBe("Championship warm-up")
    expect(publicSlotLabel("  ", "Practice")).toBe("Practice")
    expect(publicSlotLabel(null, null)).toBe("Reserved")
  })
})

describe("buildIceScheduleBoard", () => {
  it("orders rinks by sort order and slots by start; empty rinks stay visible", () => {
    const board = buildIceScheduleBoard(
      RINKS,
      [
        booking({ id: "later", startsAt: "2026-08-28T23:00:00.000Z", endsAt: "2026-08-29T00:00:00.000Z" }),
        booking({ id: "sooner" }),
      ],
      NOW,
      12,
    )
    expect(board.rinks.map((r) => r.name)).toEqual(["North Rink", "South Rink"])
    expect(board.rinks[0].slots.map((s) => s.label)).toEqual(["Public Skate", "Public Skate"])
    expect(Date.parse(board.rinks[0].slots[0].startsAt)).toBeLessThan(
      Date.parse(board.rinks[0].slots[1].startsAt),
    )
    expect(board.rinks[1].slots).toEqual([])
  })

  it("keeps only bookings overlapping the window; cancelled never shows", () => {
    const board = buildIceScheduleBoard(
      RINKS,
      [
        booking({ id: "past", startsAt: "2026-08-28T18:00:00.000Z", endsAt: "2026-08-28T19:30:00.000Z" }),
        booking({ id: "beyond", startsAt: "2026-08-29T09:00:00.000Z", endsAt: "2026-08-29T10:00:00.000Z" }),
        booking({ id: "cancelled", status: "cancelled" }),
        booking({ id: "live", startsAt: "2026-08-28T19:30:00.000Z", endsAt: "2026-08-28T20:30:00.000Z" }),
      ],
      NOW,
      12,
    )
    const slots = board.rinks[0].slots
    expect(slots).toHaveLength(1)
    expect(slots[0].current).toBe(true)
  })

  it("marks current only for start <= now < end", () => {
    const board = buildIceScheduleBoard(RINKS, [booking({})], NOW, 12)
    expect(board.rinks[0].slots[0].current).toBe(false)
    expect(board.windowEndsAt).toBe("2026-08-29T08:00:00.000Z")
  })
})
