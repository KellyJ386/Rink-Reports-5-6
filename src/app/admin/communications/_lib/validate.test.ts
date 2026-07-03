import { describe, expect, it } from "vitest"

import { parseReminderForm, parseRoutingForm, slugify } from "./validate"

const GROUP = "11111111-1111-4111-8111-111111111111"
const DEPT = "22222222-2222-4222-8222-222222222222"
const TPL = "33333333-3333-4333-8333-333333333333"

function fd(entries: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

describe("slugify", () => {
  it("lowercases, strips quotes, and hyphenates", () => {
    expect(slugify("Zamboni Crew's \"A\" Team")).toBe("zamboni-crews-a-team")
  })

  it("trims leading/trailing separators and caps length", () => {
    expect(slugify("--hello--")).toBe("hello")
    expect(slugify("x".repeat(80))).toHaveLength(64)
  })
})

describe("parseRoutingForm", () => {
  const base = {
    source_module: "air_quality",
    target_kind: "group",
    target_group_id: GROUP,
  }

  it("parses a minimal group-targeted rule with defaults", () => {
    const r = parseRoutingForm(fd(base))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.source_module).toBe("air_quality")
    expect(r.data.target_group_id).toBe(GROUP)
    expect(r.data.severity).toBeNull()
    expect(r.data.timing).toBe("immediate")
    expect(r.data.priority).toBe(0)
    expect(r.data.is_active).toBe(true)
    expect(r.data.attach_pdf).toBe(false)
    expect(r.data.requires_acknowledgement).toBe(false)
  })

  it("requires a source module", () => {
    const r = parseRoutingForm(fd({ target_kind: "group", target_group_id: GROUP }))
    expect(r).toEqual({ ok: false, error: "Source module is required." })
  })

  it("treats severity 'any' as null and rejects junk severities", () => {
    const any = parseRoutingForm(fd({ ...base, severity: "any" }))
    expect(any.ok && any.data.severity === null).toBe(true)
    const bad = parseRoutingForm(fd({ ...base, severity: "catastrophic" }))
    expect(bad).toEqual({ ok: false, error: "Invalid severity." })
  })

  it("enforces exactly one target: each kind requires its own id", () => {
    expect(parseRoutingForm(fd({ ...base, target_group_id: "" })).ok).toBe(false)
    const role = parseRoutingForm(
      fd({ source_module: "daily", target_kind: "role", target_role_key: "staff" }),
    )
    expect(role.ok && role.data.target_role_key === "staff").toBe(true)
    const badRole = parseRoutingForm(
      fd({ source_module: "daily", target_kind: "role", target_role_key: "Not Valid!" }),
    )
    expect(badRole).toEqual({ ok: false, error: "Invalid role key." })
    const dept = parseRoutingForm(
      fd({ source_module: "daily", target_kind: "department", target_department_id: DEPT }),
    )
    expect(dept.ok && dept.data.target_department_id === DEPT).toBe(true)
    const badKind = parseRoutingForm(fd({ source_module: "daily", target_kind: "planet" }))
    expect(badKind.ok).toBe(false)
  })

  it("rejects a non-UUID area id but accepts a blank one", () => {
    const bad = parseRoutingForm(fd({ ...base, area_id: "rink-1" }))
    expect(bad.ok).toBe(false)
    const blank = parseRoutingForm(fd({ ...base, area_id: "" }))
    expect(blank.ok && blank.data.area_id === null).toBe(true)
  })

  it("rejects unknown timing values", () => {
    const r = parseRoutingForm(fd({ ...base, timing: "fortnightly" }))
    expect(r).toEqual({ ok: false, error: "Invalid timing value." })
  })
})

describe("parseReminderForm", () => {
  const base = {
    name: "Morning checklist",
    schedule_cron: "0 8 * * 1",
    template_id: TPL,
    target_kind: "role",
    target_role_key: "staff",
  }

  it("parses a role-targeted reminder", () => {
    const r = parseReminderForm(fd(base))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.schedule_cron).toBe("0 8 * * 1")
    expect(r.data.target_role_key).toBe("staff")
    expect(r.data.target_group_id).toBeNull()
  })

  it("rejects crons without exactly 5 fields", () => {
    expect(parseReminderForm(fd({ ...base, schedule_cron: "0 8 * *" })).ok).toBe(false)
    expect(
      parseReminderForm(fd({ ...base, schedule_cron: "0 8 * * 1 2" })).ok,
    ).toBe(false)
  })

  it("rejects cron fields with disallowed characters", () => {
    const r = parseReminderForm(fd({ ...base, schedule_cron: "0 8 * * MON" }))
    expect(r.ok).toBe(false)
  })

  it("requires a group or role target", () => {
    const r = parseReminderForm(
      fd({ name: "x", schedule_cron: "0 8 * * 1", template_id: TPL }),
    )
    expect(r).toEqual({ ok: false, error: "Pick a target type (group or role)." })
  })

  it("normalizes next_run_at to ISO and rejects invalid timestamps", () => {
    const good = parseReminderForm(
      fd({ ...base, next_run_at: "2026-07-04T08:00" }),
    )
    expect(good.ok && good.data.next_run_at?.endsWith("Z")).toBe(true)
    const bad = parseReminderForm(fd({ ...base, next_run_at: "not-a-date" }))
    expect(bad.ok).toBe(false)
  })
})
