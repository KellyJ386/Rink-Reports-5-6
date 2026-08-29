import { describe, expect, it } from "vitest"

import {
  buildDeskAgenda,
  deskDayOptions,
  nextPublicSkate,
  nextResurfacePerRink,
  type DeskBookingRow,
  type DeskRinkRow,
  type DeskTypeRow,
} from "./desk-agenda"

const TZ = "America/New_York"

const RINKS: DeskRinkRow[] = [
  { id: "rink-a", name: "Rink A" },
  { id: "rink-b", name: "Rink B" },
]
const rinkById = new Map(RINKS.map((r) => [r.id, r]))

const TYPES: DeskTypeRow[] = [
  { id: "type-public", name: "Public Skate", color: "#2F9E00", slug: "public-skate", is_resurface: false },
  { id: "type-lts", name: "Learn to Skate", color: "#1E88E5", slug: "learn-to-skate", is_resurface: false },
  { id: "type-cut", name: "Ice Cut", color: "#56666F", slug: "ice-cut", is_resurface: true },
]
const typeById = new Map(TYPES.map((t) => [t.id, t]))

function booking(overrides: Partial<DeskBookingRow>): DeskBookingRow {
  return {
    id: "b1",
    rink_id: "rink-a",
    booking_type_id: "type-public",
    starts_at: "2026-09-01T14:00:00.000Z", // 10:00 AM ET
    ends_at: "2026-09-01T15:00:00.000Z",
    status: "confirmed",
    title: null,
    resurface_status: null,
    ...overrides,
  }
}

function resurfaceBooking(overrides: Partial<DeskBookingRow>): DeskBookingRow {
  return booking({
    booking_type_id: "type-cut",
    resurface_status: "scheduled",
    ...overrides,
  })
}

describe("deskDayOptions", () => {
  it("returns today through 7 days out, inclusive", () => {
    expect(deskDayOptions("2026-09-01")).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
    ])
  })
})

describe("buildDeskAgenda", () => {
  it("builds a sorted row per booking on the day", () => {
    const bookings = [
      booking({ id: "b2", rink_id: "rink-b", starts_at: "2026-09-01T18:00:00.000Z", ends_at: "2026-09-01T19:00:00.000Z" }),
      booking({ id: "b1" }),
    ]
    const rows = buildDeskAgenda({ bookings, rinkById, typeById, dayKey: "2026-09-01", timeZone: TZ })
    expect(rows.map((r) => r.bookingId)).toEqual(["b1", "b2"])
    expect(rows[0].rinkName).toBe("Rink A")
    expect(rows[0].typeName).toBe("Public Skate")
    expect(rows[0].isResurface).toBe(false)
  })

  it("excludes cancelled bookings", () => {
    const rows = buildDeskAgenda({
      bookings: [booking({ status: "cancelled" })],
      rinkById,
      typeById,
      dayKey: "2026-09-01",
      timeZone: TZ,
    })
    expect(rows).toEqual([])
  })

  it("excludes a booking that does not fall on the requested day", () => {
    const rows = buildDeskAgenda({
      bookings: [booking({})],
      rinkById,
      typeById,
      dayKey: "2026-09-02",
      timeZone: TZ,
    })
    expect(rows).toEqual([])
  })

  it("flags a resurface-typed booking as isResurface", () => {
    const rows = buildDeskAgenda({
      bookings: [resurfaceBooking({})],
      rinkById,
      typeById,
      dayKey: "2026-09-01",
      timeZone: TZ,
    })
    expect(rows[0].isResurface).toBe(true)
  })

  it("filters to the selected booking type but always keeps resurfaces", () => {
    const bookings = [
      booking({ id: "public", booking_type_id: "type-public" }),
      booking({ id: "lts", booking_type_id: "type-lts" }),
      resurfaceBooking({ id: "cut" }),
    ]
    const rows = buildDeskAgenda({
      bookings,
      rinkById,
      typeById,
      dayKey: "2026-09-01",
      timeZone: TZ,
      typeFilterId: "type-public",
    })
    expect(rows.map((r) => r.bookingId).sort()).toEqual(["cut", "public"])
  })

  it("falls back to the type name when a booking has no title", () => {
    const rows = buildDeskAgenda({
      bookings: [booking({ title: "  " })],
      rinkById,
      typeById,
      dayKey: "2026-09-01",
      timeZone: TZ,
    })
    expect(rows[0].label).toBe("Public Skate")
  })
})

describe("nextResurfacePerRink", () => {
  const now = new Date("2026-09-01T12:00:00.000Z").getTime()

  it("finds the earliest upcoming scheduled resurface per rink and nulls out rinks with none", () => {
    const bookings = [
      resurfaceBooking({ id: "late", rink_id: "rink-a", starts_at: "2026-09-02T00:00:00.000Z", ends_at: "2026-09-02T00:30:00.000Z" }),
      resurfaceBooking({ id: "early", rink_id: "rink-a", starts_at: "2026-09-01T20:00:00.000Z", ends_at: "2026-09-01T20:30:00.000Z" }),
      resurfaceBooking({ id: "past", rink_id: "rink-a", starts_at: "2026-08-31T20:00:00.000Z", ends_at: "2026-08-31T20:30:00.000Z" }),
      booking({ id: "not-cut", rink_id: "rink-b", booking_type_id: "type-public" }),
    ]
    const result = nextResurfacePerRink({ bookings, rinkIds: ["rink-a", "rink-b"], typeById, nowMs: now })
    expect(result.get("rink-a")?.startsAt).toBe("2026-09-01T20:00:00.000Z")
    expect(result.get("rink-b")).toBeNull()
  })

  it("ignores cancelled resurfaces", () => {
    const bookings = [resurfaceBooking({ status: "cancelled" })]
    const result = nextResurfacePerRink({ bookings, rinkIds: ["rink-a"], typeById, nowMs: now })
    expect(result.get("rink-a")).toBeNull()
  })

  it("ignores a resurface already completed or skipped, even if its time is still in the future", () => {
    const bookings = [
      resurfaceBooking({ id: "done", resurface_status: "completed", starts_at: "2026-09-02T00:00:00.000Z", ends_at: "2026-09-02T00:30:00.000Z" }),
      resurfaceBooking({ id: "skipped", resurface_status: "skipped", starts_at: "2026-09-02T01:00:00.000Z", ends_at: "2026-09-02T01:30:00.000Z" }),
    ]
    const result = nextResurfacePerRink({ bookings, rinkIds: ["rink-a"], typeById, nowMs: now })
    expect(result.get("rink-a")).toBeNull()
  })
})

describe("nextPublicSkate", () => {
  const now = new Date("2026-09-01T12:00:00.000Z").getTime()

  it("finds the earliest upcoming public skate session facility-wide", () => {
    const bookings = [
      booking({ id: "b-late", rink_id: "rink-b", starts_at: "2026-09-03T14:00:00.000Z", ends_at: "2026-09-03T15:00:00.000Z" }),
      booking({ id: "b-early", rink_id: "rink-a", starts_at: "2026-09-02T14:00:00.000Z", ends_at: "2026-09-02T15:00:00.000Z" }),
    ]
    const result = nextPublicSkate({ bookings, typeById, nowMs: now })
    expect(result?.rinkId).toBe("rink-a")
    expect(result?.startsAt).toBe("2026-09-02T14:00:00.000Z")
  })

  it("returns null when nothing upcoming matches the slug", () => {
    const result = nextPublicSkate({ bookings: [booking({ booking_type_id: "type-lts" })], typeById, nowMs: now })
    expect(result).toBeNull()
  })

  it("counts a session already in progress", () => {
    const inProgress = booking({ starts_at: "2026-09-01T11:00:00.000Z", ends_at: "2026-09-01T13:00:00.000Z" })
    const result = nextPublicSkate({ bookings: [inProgress], typeById, nowMs: now })
    expect(result?.startsAt).toBe("2026-09-01T11:00:00.000Z")
  })
})
