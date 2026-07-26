import { describe, expect, it } from "vitest"

import { buildAuditRow, firstForwardedIp } from "./build"

describe("firstForwardedIp", () => {
  it("takes the first hop of a forwarded chain", () => {
    expect(firstForwardedIp("203.0.113.7, 10.0.0.1, 10.0.0.2")).toBe(
      "203.0.113.7"
    )
  })

  it("trims whitespace and normalizes blanks to null", () => {
    expect(firstForwardedIp("  203.0.113.7  ")).toBe("203.0.113.7")
    expect(firstForwardedIp("")).toBeNull()
    expect(firstForwardedIp("   ,10.0.0.1")).toBeNull()
    expect(firstForwardedIp(null)).toBeNull()
  })
})

describe("buildAuditRow", () => {
  const input = {
    facilityId: "11111111-1111-1111-1111-111111111111",
    action: "preview.start",
    entityType: "employees",
    entityId: "aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    after: { target_name: "Alice Anderson" },
  }

  it("assembles the full row", () => {
    const row = buildAuditRow(
      input,
      {
        authUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        employeeId: "aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      },
      { forwardedFor: "203.0.113.7, 10.0.0.1", userAgent: "vitest" }
    )
    expect(row).toEqual({
      facility_id: input.facilityId,
      actor_user_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      actor_employee_id: "aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      action: "preview.start",
      entity_type: "employees",
      entity_id: input.entityId,
      before: null,
      after: { target_name: "Alice Anderson" },
      ip: "203.0.113.7",
      user_agent: "vitest",
    })
  })

  it("defaults optional fields to null", () => {
    const row = buildAuditRow(
      { facilityId: "f", action: "a", entityType: "t" },
      { authUserId: null, employeeId: null },
      { forwardedFor: null, userAgent: null }
    )
    expect(row.entity_id).toBeNull()
    expect(row.before).toBeNull()
    expect(row.after).toBeNull()
    expect(row.ip).toBeNull()
    expect(row.user_agent).toBeNull()
    expect(row.actor_user_id).toBeNull()
    expect(row.actor_employee_id).toBeNull()
  })
})
