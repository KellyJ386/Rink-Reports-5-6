import { describe, expect, it } from "vitest"

import { MODULE_NAMES, presetMatrix } from "./actions"

// The elevated modules staff-shaped presets must never auto-grant (migration
// 268: staff hold nothing on `reports`; `admin` is the Admin Center module).
const ELEVATED = ["reports", "admin"] as const

describe("presetMatrix", () => {
  it("no_access grants nothing anywhere", () => {
    const m = presetMatrix("no_access")
    for (const mod of MODULE_NAMES) {
      expect(m[mod]).toEqual({ view: false, submit: false, edit: false, admin: false })
    }
  })

  it("submitter_only never grants the elevated modules (reports / admin)", () => {
    const m = presetMatrix("submitter_only")
    for (const mod of ELEVATED) {
      expect(m[mod]).toEqual({ view: false, submit: false, edit: false, admin: false })
    }
  })

  it("viewer_only never grants the elevated modules (reports / admin)", () => {
    const m = presetMatrix("viewer_only")
    for (const mod of ELEVATED) {
      expect(m[mod]).toEqual({ view: false, submit: false, edit: false, admin: false })
    }
  })

  it("submitter_only still grants view+submit on ordinary report modules", () => {
    const m = presetMatrix("submitter_only")
    expect(m.daily_reports).toEqual({ view: true, submit: true, edit: false, admin: false })
    expect(m.incident_reports.submit).toBe(true)
  })

  it("viewer_only grants view only on ordinary modules", () => {
    const m = presetMatrix("viewer_only")
    expect(m.refrigeration).toEqual({ view: true, submit: false, edit: false, admin: false })
  })

  it("full_access remains the elevated preset and grants every module", () => {
    const m = presetMatrix("full_access")
    for (const mod of MODULE_NAMES) {
      expect(m[mod]).toEqual({ view: true, submit: true, edit: true, admin: true })
    }
  })
})
