import { describe, expect, it } from "vitest"

import {
  buildDisplayBoard,
  deriveOccupancyWindow,
  findRoomOverlaps,
  isPlausibleDisplayToken,
  readDisplaySettings,
  type AssignmentWindow,
  type DisplayAssignmentRow,
  type DisplayRoomRow,
} from "./locker-display"

const TZ = "America/New_York"

describe("deriveOccupancyWindow", () => {
  it("pads the booking by the configured lead and vacate minutes", () => {
    const w = deriveOccupancyWindow(
      "2026-01-15T18:00:00.000Z",
      "2026-01-15T19:30:00.000Z",
      45,
      30,
    )
    expect(w).toEqual({
      occupiesFromIso: "2026-01-15T17:15:00.000Z",
      occupiesUntilIso: "2026-01-15T20:00:00.000Z",
    })
  })

  it("supports zero padding on both sides", () => {
    const w = deriveOccupancyWindow(
      "2026-01-15T18:00:00.000Z",
      "2026-01-15T19:00:00.000Z",
      0,
      0,
    )
    expect(w).toEqual({
      occupiesFromIso: "2026-01-15T18:00:00.000Z",
      occupiesUntilIso: "2026-01-15T19:00:00.000Z",
    })
  })

  it("clamps padding to the range the CHECK constraints allow", () => {
    const w = deriveOccupancyWindow(
      "2026-01-15T18:00:00.000Z",
      "2026-01-15T19:00:00.000Z",
      -20,
      9999,
    )
    // -20 clamps to 0; 9999 clamps to 480 minutes (8h).
    expect(w).toEqual({
      occupiesFromIso: "2026-01-15T18:00:00.000Z",
      occupiesUntilIso: "2026-01-16T03:00:00.000Z",
    })
  })

  it("rounds fractional minutes rather than emitting sub-minute drift", () => {
    const w = deriveOccupancyWindow(
      "2026-01-15T18:00:00.000Z",
      "2026-01-15T19:00:00.000Z",
      10.4,
      0,
    )
    expect(w?.occupiesFromIso).toBe("2026-01-15T17:50:00.000Z")
  })

  it("returns null for an unparseable window", () => {
    expect(deriveOccupancyWindow("nope", "2026-01-15T19:00:00.000Z", 45, 30)).toBeNull()
    expect(deriveOccupancyWindow("2026-01-15T18:00:00.000Z", "nope", 45, 30)).toBeNull()
  })

  it("returns null when the booking does not move forward in time", () => {
    expect(
      deriveOccupancyWindow("2026-01-15T19:00:00.000Z", "2026-01-15T18:00:00.000Z", 0, 0),
    ).toBeNull()
    expect(
      deriveOccupancyWindow("2026-01-15T18:00:00.000Z", "2026-01-15T18:00:00.000Z", 0, 0),
    ).toBeNull()
  })

  it("crosses a DST spring-forward boundary as real elapsed time", () => {
    // 2026-03-08 07:00Z is 2:00am EST, the instant the US clock jumps to 3am.
    const w = deriveOccupancyWindow(
      "2026-03-08T07:30:00.000Z",
      "2026-03-08T08:30:00.000Z",
      60,
      0,
    )
    // One hour before is a real hour, not a wall-clock hour.
    expect(w?.occupiesFromIso).toBe("2026-03-08T06:30:00.000Z")
  })
})

describe("findRoomOverlaps", () => {
  const base: AssignmentWindow[] = [
    {
      id: "a",
      lockerRoomId: "room-1",
      occupiesFrom: "2026-01-15T17:00:00.000Z",
      occupiesUntil: "2026-01-15T19:00:00.000Z",
    },
    {
      id: "b",
      lockerRoomId: "room-2",
      occupiesFrom: "2026-01-15T17:00:00.000Z",
      occupiesUntil: "2026-01-15T19:00:00.000Z",
    },
  ]

  it("reports a hold that straddles the candidate window", () => {
    const hits = findRoomOverlaps(base, {
      id: "new",
      lockerRoomId: "room-1",
      occupiesFrom: "2026-01-15T18:00:00.000Z",
      occupiesUntil: "2026-01-15T20:00:00.000Z",
    })
    expect(hits.map((h) => h.id)).toEqual(["a"])
  })

  it("ignores holds on a different room", () => {
    const hits = findRoomOverlaps(base, {
      id: "new",
      lockerRoomId: "room-3",
      occupiesFrom: "2026-01-15T18:00:00.000Z",
      occupiesUntil: "2026-01-15T20:00:00.000Z",
    })
    expect(hits).toEqual([])
  })

  it("treats the windows as half-open: touching is not overlapping", () => {
    const hits = findRoomOverlaps(base, {
      id: "new",
      lockerRoomId: "room-1",
      occupiesFrom: "2026-01-15T19:00:00.000Z",
      occupiesUntil: "2026-01-15T21:00:00.000Z",
    })
    expect(hits).toEqual([])
  })

  it("does not report a row against itself when editing", () => {
    const hits = findRoomOverlaps(base, {
      id: "a",
      lockerRoomId: "room-1",
      occupiesFrom: "2026-01-15T17:30:00.000Z",
      occupiesUntil: "2026-01-15T19:30:00.000Z",
    })
    expect(hits).toEqual([])
  })

  it("reports a candidate fully contained by an existing hold", () => {
    const hits = findRoomOverlaps(base, {
      id: "new",
      lockerRoomId: "room-1",
      occupiesFrom: "2026-01-15T17:30:00.000Z",
      occupiesUntil: "2026-01-15T18:00:00.000Z",
    })
    expect(hits.map((h) => h.id)).toEqual(["a"])
  })

  it("skips existing rows with unparseable timestamps instead of throwing", () => {
    const hits = findRoomOverlaps(
      [{ id: "bad", lockerRoomId: "room-1", occupiesFrom: "x", occupiesUntil: "y" }],
      {
        id: "new",
        lockerRoomId: "room-1",
        occupiesFrom: "2026-01-15T17:30:00.000Z",
        occupiesUntil: "2026-01-15T18:00:00.000Z",
      },
    )
    expect(hits).toEqual([])
  })

  it("returns nothing when the candidate itself is unparseable", () => {
    const hits = findRoomOverlaps(base, {
      id: "new",
      lockerRoomId: "room-1",
      occupiesFrom: "not-a-date",
      occupiesUntil: "2026-01-15T18:00:00.000Z",
    })
    expect(hits).toEqual([])
  })
})

describe("buildDisplayBoard", () => {
  const rooms: DisplayRoomRow[] = [
    { id: "r2", name: "Locker 2", shortCode: "L2", sortOrder: 2 },
    { id: "r1", name: "Locker 1", shortCode: "L1", sortOrder: 1 },
  ]

  const NOW = Date.parse("2026-01-15T18:00:00.000Z")

  function row(over: Partial<DisplayAssignmentRow> = {}): DisplayAssignmentRow {
    return {
      assignmentId: "a1",
      lockerRoomId: "r1",
      lockerRoomName: "Locker 1",
      lockerRoomShortCode: "L1",
      sortOrder: 1,
      occupiesFrom: "2026-01-15T17:30:00.000Z",
      occupiesUntil: "2026-01-15T19:00:00.000Z",
      label: "Bantam A",
      rinkName: "Main Rink",
      rinkColor: "#4DFF00",
      ...over,
    }
  }

  it("orders rooms by sort_order and keeps idle rooms on the board", () => {
    const board = buildDisplayBoard(rooms, [], NOW, 12, TZ)
    expect(board.rooms.map((r) => r.name)).toEqual(["Locker 1", "Locker 2"])
    expect(board.rooms.every((r) => r.now === null && r.next.length === 0)).toBe(true)
  })

  it("puts an in-progress hold in `now` with facility-local clock labels", () => {
    const board = buildDisplayBoard(rooms, [row()], NOW, 12, TZ)
    const r1 = board.rooms.find((r) => r.lockerRoomId === "r1")!
    expect(r1.now?.label).toBe("Bantam A")
    expect(r1.now?.state).toBe("occupied")
    expect(r1.now?.startsInMinutes).toBe(0)
    // 17:30Z / 19:00Z in New York in January (EST, UTC-5).
    expect(r1.now?.fromLabel).toBe("12:30 PM")
    expect(r1.now?.untilLabel).toBe("2:00 PM")
  })

  it("lists a future hold under `next` with minutes-until", () => {
    const board = buildDisplayBoard(
      rooms,
      [
        row({
          assignmentId: "a2",
          occupiesFrom: "2026-01-15T19:15:00.000Z",
          occupiesUntil: "2026-01-15T20:00:00.000Z",
        }),
      ],
      NOW,
      12,
      TZ,
    )
    const r1 = board.rooms.find((r) => r.lockerRoomId === "r1")!
    expect(r1.now).toBeNull()
    expect(r1.next).toHaveLength(1)
    expect(r1.next[0].state).toBe("upcoming")
    expect(r1.next[0].startsInMinutes).toBe(75)
  })

  it("drops holds that have already ended", () => {
    const board = buildDisplayBoard(
      rooms,
      [row({ occupiesFrom: "2026-01-15T16:00:00.000Z", occupiesUntil: "2026-01-15T17:00:00.000Z" })],
      NOW,
      12,
      TZ,
    )
    expect(board.rooms.find((r) => r.lockerRoomId === "r1")!.now).toBeNull()
  })

  it("drops a hold ending exactly now — the room is free again", () => {
    const board = buildDisplayBoard(
      rooms,
      [row({ occupiesFrom: "2026-01-15T17:00:00.000Z", occupiesUntil: "2026-01-15T18:00:00.000Z" })],
      NOW,
      12,
      TZ,
    )
    expect(board.rooms.find((r) => r.lockerRoomId === "r1")!.now).toBeNull()
  })

  it("drops holds beyond the token's look-ahead horizon", () => {
    const far = row({
      assignmentId: "far",
      occupiesFrom: "2026-01-16T06:00:00.000Z",
      occupiesUntil: "2026-01-16T07:00:00.000Z",
    })
    expect(buildDisplayBoard(rooms, [far], NOW, 2, TZ).rooms[0].next).toHaveLength(0)
    expect(buildDisplayBoard(rooms, [far], NOW, 24, TZ).rooms[0].next).toHaveLength(1)
  })

  it("keeps a second overlapping hold visible rather than hiding it", () => {
    const board = buildDisplayBoard(
      rooms,
      [
        row({ assignmentId: "first" }),
        row({
          assignmentId: "second",
          occupiesFrom: "2026-01-15T17:45:00.000Z",
          occupiesUntil: "2026-01-15T19:30:00.000Z",
          label: "Squirt B",
        }),
      ],
      NOW,
      12,
      TZ,
    )
    const r1 = board.rooms.find((r) => r.lockerRoomId === "r1")!
    expect(r1.now?.assignmentId).toBe("first")
    expect(r1.next.map((s) => s.assignmentId)).toEqual(["second"])
  })

  it("sorts upcoming holds by start and caps the list", () => {
    const board = buildDisplayBoard(
      rooms,
      [
        row({ assignmentId: "c", occupiesFrom: "2026-01-15T22:00:00.000Z", occupiesUntil: "2026-01-15T23:00:00.000Z" }),
        row({ assignmentId: "a", occupiesFrom: "2026-01-15T19:00:00.000Z", occupiesUntil: "2026-01-15T20:00:00.000Z" }),
        row({ assignmentId: "b", occupiesFrom: "2026-01-15T20:30:00.000Z", occupiesUntil: "2026-01-15T21:00:00.000Z" }),
      ],
      NOW,
      12,
      TZ,
      2,
    )
    expect(board.rooms[0].next.map((s) => s.assignmentId)).toEqual(["a", "b"])
  })

  it("ignores assignments pointing at a room that is not on the board", () => {
    const board = buildDisplayBoard(rooms, [row({ lockerRoomId: "ghost" })], NOW, 12, TZ)
    expect(board.rooms.every((r) => r.now === null)).toBe(true)
  })

  it("skips rows with unparseable timestamps", () => {
    const board = buildDisplayBoard(rooms, [row({ occupiesFrom: "nope" })], NOW, 12, TZ)
    expect(board.rooms.find((r) => r.lockerRoomId === "r1")!.now).toBeNull()
  })

  it("stamps generatedAt from the injected clock, not the ambient one", () => {
    expect(buildDisplayBoard(rooms, [], NOW, 12, TZ).generatedAtIso).toBe(
      "2026-01-15T18:00:00.000Z",
    )
  })

  it("falls back to name ordering when sort_order ties", () => {
    const tied: DisplayRoomRow[] = [
      { id: "b", name: "Visitor", shortCode: "V", sortOrder: 0 },
      { id: "a", name: "Home", shortCode: "H", sortOrder: 0 },
    ]
    expect(buildDisplayBoard(tied, [], NOW, 12, TZ).rooms.map((r) => r.name)).toEqual([
      "Home",
      "Visitor",
    ])
  })
})

describe("isPlausibleDisplayToken", () => {
  const good = "a".repeat(43)

  it("accepts a 43-character base64url token", () => {
    expect(isPlausibleDisplayToken(good)).toBe(true)
    expect(isPlausibleDisplayToken("A9_-".repeat(10) + "abc")).toBe(true)
  })

  it("rejects the wrong length", () => {
    expect(isPlausibleDisplayToken("a".repeat(42))).toBe(false)
    expect(isPlausibleDisplayToken("a".repeat(44))).toBe(false)
    expect(isPlausibleDisplayToken("")).toBe(false)
  })

  it("rejects characters outside the base64url alphabet", () => {
    expect(isPlausibleDisplayToken("a".repeat(42) + "/")).toBe(false)
    expect(isPlausibleDisplayToken("a".repeat(42) + "=")).toBe(false)
    expect(isPlausibleDisplayToken("../../etc/passwd")).toBe(false)
  })

  it("rejects non-strings", () => {
    expect(isPlausibleDisplayToken(null)).toBe(false)
    expect(isPlausibleDisplayToken(undefined)).toBe(false)
    expect(isPlausibleDisplayToken(43)).toBe(false)
  })
})

describe("readDisplaySettings", () => {
  it("reads hours_ahead and refresh_seconds from the token settings", () => {
    expect(readDisplaySettings({ hours_ahead: 8, refresh_seconds: 45 }, 60)).toEqual({
      hoursAhead: 8,
      refreshSeconds: 45,
    })
  })

  it("falls back to the facility refresh when the token omits one", () => {
    expect(readDisplaySettings({ hours_ahead: 8 }, 120).refreshSeconds).toBe(120)
  })

  it("clamps values outside the admin-enforced ranges", () => {
    expect(readDisplaySettings({ hours_ahead: 500, refresh_seconds: 1 }, 60)).toEqual({
      hoursAhead: 48,
      refreshSeconds: 15,
    })
    expect(readDisplaySettings({ hours_ahead: 0, refresh_seconds: 99999 }, 60)).toEqual({
      hoursAhead: 1,
      refreshSeconds: 3600,
    })
  })

  it("survives a settings value that is not an object", () => {
    expect(readDisplaySettings(null, 60)).toEqual({ hoursAhead: 12, refreshSeconds: 60 })
    expect(readDisplaySettings([1, 2], 60)).toEqual({ hoursAhead: 12, refreshSeconds: 60 })
    expect(readDisplaySettings("nope", 60)).toEqual({ hoursAhead: 12, refreshSeconds: 60 })
  })

  it("ignores non-numeric settings values", () => {
    expect(readDisplaySettings({ hours_ahead: "8", refresh_seconds: null }, 60)).toEqual({
      hoursAhead: 12,
      refreshSeconds: 60,
    })
  })
})
