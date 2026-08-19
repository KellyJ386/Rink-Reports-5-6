import { describe, expect, it } from "vitest"

import { buildAuditRow, trustedClientIp } from "./build"

describe("trustedClientIp", () => {
  it("prefers x-real-ip over any forwarded chain", () => {
    expect(trustedClientIp("198.51.100.9", "203.0.113.7, 10.0.0.1")).toBe(
      "198.51.100.9"
    )
    expect(trustedClientIp("  198.51.100.9  ", null)).toBe("198.51.100.9")
  })

  it("falls back to the RIGHTMOST forwarded hop (the trusted-proxy one), never the client-chosen leftmost", () => {
    expect(trustedClientIp(null, "203.0.113.7, 10.0.0.1, 10.0.0.2")).toBe(
      "10.0.0.2"
    )
    expect(trustedClientIp(null, "spoofed-by-client, 192.0.2.44")).toBe(
      "192.0.2.44"
    )
  })

  it("normalizes blanks to null", () => {
    expect(trustedClientIp(null, "  203.0.113.7  ")).toBe("203.0.113.7")
    expect(trustedClientIp("", "")).toBeNull()
    expect(trustedClientIp(null, "   ,")).toBeNull()
    expect(trustedClientIp(null, null)).toBeNull()
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
      {
        realIp: "203.0.113.7",
        forwardedFor: "spoofed, 10.0.0.1",
        userAgent: "vitest",
      }
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
      { realIp: null, forwardedFor: null, userAgent: null }
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
