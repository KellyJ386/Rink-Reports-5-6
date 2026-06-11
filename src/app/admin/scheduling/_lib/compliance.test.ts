import { describe, expect, it } from "vitest"

import {
  complianceWeekWindow,
  evaluateComplianceWarnings,
  shiftHours,
  type EmployeeForCompliance,
  type SettingsForCompliance,
  type ShiftForHours,
} from "./compliance"

function shift(
  startsAt: string,
  endsAt: string,
  breakMinutes: number | null = null,
): ShiftForHours {
  return { starts_at: startsAt, ends_at: endsAt, break_minutes: breakMinutes }
}

/** An 8h shift (9–17 UTC) on the given ISO date. */
function dayShift(isoDate: string, breakMinutes: number | null = null) {
  return shift(
    `${isoDate}T09:00:00.000Z`,
    `${isoDate}T17:00:00.000Z`,
    breakMinutes,
  )
}

const settings: SettingsForCompliance = {
  minor_max_weekly_hours: 20,
  overtime_weekly_hours: 40,
}

const minor: EmployeeForCompliance = { id: "e1", is_minor: true }
const adult: EmployeeForCompliance = { id: "e2", is_minor: false }

describe("shiftHours", () => {
  it("computes net hours minus the break", () => {
    expect(shiftHours(dayShift("2026-06-10"))).toBe(8)
    expect(shiftHours(dayShift("2026-06-10", 30))).toBe(7.5)
    expect(shiftHours(dayShift("2026-06-10", null))).toBe(8)
  })

  it("floors at zero for inverted ranges and oversized breaks", () => {
    expect(
      shiftHours(shift("2026-06-10T17:00:00Z", "2026-06-10T09:00:00Z")),
    ).toBe(0)
    expect(shiftHours(dayShift("2026-06-10", 600))).toBe(0)
  })
})

describe("complianceWeekWindow", () => {
  const utc = { timezone: "UTC" }

  it("anchors to the preceding Sunday at local midnight (UTC facility)", () => {
    // 2026-06-10 is a Wednesday.
    const w = complianceWeekWindow("2026-06-10T15:00:00.000Z", utc)
    expect(w.startIso).toBe("2026-06-07T00:00:00.000Z")
    expect(w.endIso).toBe("2026-06-14T00:00:00.000Z")
    // A Sunday maps to itself; a Saturday maps back six days.
    expect(
      complianceWeekWindow("2026-06-07T23:59:00.000Z", utc).startIso,
    ).toBe("2026-06-07T00:00:00.000Z")
    expect(
      complianceWeekWindow("2026-06-13T00:00:00.000Z", utc).startIso,
    ).toBe("2026-06-07T00:00:00.000Z")
  })

  it("crosses month/year boundaries correctly", () => {
    expect(
      complianceWeekWindow("2026-01-01T12:00:00.000Z", utc).startIso,
    ).toBe("2025-12-28T00:00:00.000Z")
  })

  it("uses the FACILITY's calendar, not UTC's", () => {
    // 2026-06-07T02:00Z is Sunday 02:00 UTC but still Saturday June 6 in New
    // York — so the New York facility's week is the one STARTING May 31.
    const w = complianceWeekWindow("2026-06-07T02:00:00.000Z", {
      timezone: "America/New_York",
    })
    // Local midnight Sunday May 31 EDT = 04:00 UTC.
    expect(w.startIso).toBe("2026-05-31T04:00:00.000Z")
    expect(w.endIso).toBe("2026-06-07T04:00:00.000Z")
  })

  it("respects a configured week-start day", () => {
    // Monday-anchored week containing Wednesday June 10.
    const w = complianceWeekWindow("2026-06-10T15:00:00.000Z", {
      timezone: "UTC",
      weekStartDay: 1,
    })
    expect(w.startIso).toBe("2026-06-08T00:00:00.000Z")
    expect(w.endIso).toBe("2026-06-15T00:00:00.000Z")
  })

  it("spans 167 real hours across the US spring-forward week", () => {
    // DST began 2026-03-08 02:00 in New York; the local week is an hour short.
    const w = complianceWeekWindow("2026-03-11T12:00:00.000Z", {
      timezone: "America/New_York",
    })
    expect(w.startIso).toBe("2026-03-08T05:00:00.000Z") // EST midnight
    expect(w.endIso).toBe("2026-03-15T04:00:00.000Z") // EDT midnight
    const hours =
      (new Date(w.endIso).getTime() - new Date(w.startIso).getTime()) / 3.6e6
    expect(hours).toBe(167)
  })
})

describe("evaluateComplianceWarnings", () => {
  it("returns no warnings under both thresholds", () => {
    expect(
      evaluateComplianceWarnings({
        shift: dayShift("2026-06-10"),
        otherShifts: [dayShift("2026-06-08")],
        settings,
        employee: adult,
      }),
    ).toEqual([])
  })

  it("flags overtime when total crosses the facility threshold", () => {
    const fourDays = ["2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11"]
    expect(
      evaluateComplianceWarnings({
        shift: shift("2026-06-12T09:00:00Z", "2026-06-12T18:00:00Z"), // 9h → 41
        otherShifts: fourDays.map((d) => dayShift(d)), // 32h
        settings,
        employee: adult,
      }),
    ).toEqual(["overtime"])
  })

  it("does not flag exactly at the threshold (strictly greater only)", () => {
    expect(
      evaluateComplianceWarnings({
        shift: dayShift("2026-06-12"), // 8h → exactly 40
        otherShifts: [
          dayShift("2026-06-08"),
          dayShift("2026-06-09"),
          dayShift("2026-06-10"),
          dayShift("2026-06-11"),
        ],
        settings,
        employee: adult,
      }),
    ).toEqual([])
  })

  it("flags minors against the minor cap; adults are exempt from it", () => {
    const args = {
      shift: dayShift("2026-06-10"),
      otherShifts: [dayShift("2026-06-08"), dayShift("2026-06-09")], // 24h total
      settings,
    }
    expect(evaluateComplianceWarnings({ ...args, employee: minor })).toEqual([
      "minor_overtime",
    ])
    expect(evaluateComplianceWarnings({ ...args, employee: adult })).toEqual([])
  })

  it("emits both warnings when a minor crosses both thresholds", () => {
    const sixDays = [
      "2026-06-07",
      "2026-06-08",
      "2026-06-09",
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
    ]
    expect(
      evaluateComplianceWarnings({
        shift: dayShift("2026-06-13"),
        otherShifts: sixDays.map((d) => dayShift(d)), // 48h + 8h = 56h
        settings,
        employee: minor,
      }),
    ).toEqual(["minor_overtime", "overtime"])
  })

  it("null settings values disable the corresponding check", () => {
    const lots = ["2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11"].map(
      (d) => dayShift(d),
    )
    expect(
      evaluateComplianceWarnings({
        shift: shift("2026-06-12T09:00:00Z", "2026-06-12T19:00:00Z"),
        otherShifts: lots,
        settings: { minor_max_weekly_hours: null, overtime_weekly_hours: null },
        employee: minor,
      }),
    ).toEqual([])
  })

  it("breaks reduce the counted hours below the threshold", () => {
    // 5×8h would be 40h+1min... instead: 4×8h + one 8h with 60min break = 39h.
    expect(
      evaluateComplianceWarnings({
        shift: dayShift("2026-06-12", 60), // 7h
        otherShifts: [
          dayShift("2026-06-08"),
          dayShift("2026-06-09"),
          dayShift("2026-06-10"),
          dayShift("2026-06-11"),
        ], // 32h
        settings: { minor_max_weekly_hours: null, overtime_weekly_hours: 39 },
        employee: adult,
      }),
    ).toEqual([])
  })
})
