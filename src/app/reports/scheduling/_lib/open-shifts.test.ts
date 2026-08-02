import { describe, expect, it } from "vitest"

import {
  selectClaimableOpenShifts,
  selectMyPendingClaims,
  type OpenShiftRow,
} from "./open-shifts"

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0)
const WINDOW_END = NOW + 14 * 24 * 60 * 60 * 1000

function row(
  id: string,
  overrides: Partial<OpenShiftRow> & { startsAt?: string } = {}
): OpenShiftRow {
  const { startsAt, ...rest } = overrides
  return {
    id,
    approval_required: false,
    claim_status: "open",
    claimed_by_employee_id: null,
    schedule_shifts: {
      id: `shift-${id}`,
      starts_at: startsAt ?? new Date(NOW + 86_400_000).toISOString(),
      ends_at: new Date(NOW + 86_400_000 + 8 * 3_600_000).toISOString(),
      role_label: null,
      department_id: null,
      departments: null,
    },
    ...rest,
  }
}

describe("selectClaimableOpenShifts", () => {
  const opts = { nowMs: NOW, windowEndMs: WINDOW_END }

  it("keeps open shifts inside the window", () => {
    const out = selectClaimableOpenShifts([row("a")], opts)
    expect(out.map((r) => r.id)).toEqual(["a"])
  })

  it("drops listings that are not open", () => {
    const out = selectClaimableOpenShifts(
      [
        row("claimed", { claim_status: "claimed" }),
        row("filled", { claim_status: "filled" }),
        row("open"),
      ],
      opts
    )
    expect(out.map((r) => r.id)).toEqual(["open"])
  })

  it("drops a shift that already started", () => {
    const past = new Date(NOW - 3_600_000).toISOString()
    const out = selectClaimableOpenShifts([row("past", { startsAt: past })], opts)
    expect(out).toEqual([])
  })

  it("drops a shift beyond the window", () => {
    const far = new Date(WINDOW_END + 86_400_000).toISOString()
    const out = selectClaimableOpenShifts([row("far", { startsAt: far })], opts)
    expect(out).toEqual([])
  })

  it("includes the exact window boundaries", () => {
    const out = selectClaimableOpenShifts(
      [
        row("atNow", { startsAt: new Date(NOW).toISOString() }),
        row("atEnd", { startsAt: new Date(WINDOW_END).toISOString() }),
      ],
      opts
    )
    expect(out.map((r) => r.id).sort()).toEqual(["atEnd", "atNow"])
  })

  it("drops a listing whose parent shift is missing", () => {
    const orphan = { ...row("orphan"), schedule_shifts: null }
    expect(selectClaimableOpenShifts([orphan], opts)).toEqual([])
  })

  it("sorts soonest-first and caps at the limit", () => {
    const rows = [3, 1, 4, 2, 5, 6].map((d) =>
      row(`d${d}`, {
        startsAt: new Date(NOW + d * 86_400_000).toISOString(),
      })
    )
    const out = selectClaimableOpenShifts(rows, { ...opts, limit: 3 })
    expect(out.map((r) => r.id)).toEqual(["d1", "d2", "d3"])
  })

  it("ignores an unparseable start", () => {
    expect(
      selectClaimableOpenShifts([row("bad", { startsAt: "not-a-date" })], opts)
    ).toEqual([])
  })
})

describe("selectMyPendingClaims", () => {
  it("returns only this employee's claimed listings", () => {
    const rows = [
      row("mine", { claim_status: "claimed", claimed_by_employee_id: "me" }),
      row("theirs", { claim_status: "claimed", claimed_by_employee_id: "you" }),
      row("open", { claim_status: "open" }),
      row("filled", { claim_status: "filled", claimed_by_employee_id: "me" }),
    ]
    expect(selectMyPendingClaims(rows, "me").map((r) => r.id)).toEqual(["mine"])
  })

  it("is not windowed — a far-future claim still shows", () => {
    const far = new Date(WINDOW_END + 30 * 86_400_000).toISOString()
    const rows = [
      row("far", {
        claim_status: "claimed",
        claimed_by_employee_id: "me",
        startsAt: far,
      }),
    ]
    expect(selectMyPendingClaims(rows, "me")).toHaveLength(1)
  })

  it("sorts soonest-first", () => {
    const rows = [5, 2, 9].map((d) =>
      row(`d${d}`, {
        claim_status: "claimed",
        claimed_by_employee_id: "me",
        startsAt: new Date(NOW + d * 86_400_000).toISOString(),
      })
    )
    expect(selectMyPendingClaims(rows, "me").map((r) => r.id)).toEqual([
      "d2",
      "d5",
      "d9",
    ])
  })
})
