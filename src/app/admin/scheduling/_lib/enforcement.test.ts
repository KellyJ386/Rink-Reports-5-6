import { describe, expect, it } from "vitest"

import {
  describeViolation,
  formatViolations,
  isCertCode,
  partitionViolations,
} from "./enforcement"

describe("isCertCode", () => {
  it("matches cert_missing:* codes only", () => {
    expect(isCertCode("cert_missing:CPR")).toBe(true)
    expect(isCertCode("cert_missing:")).toBe(true)
    expect(isCertCode("overtime")).toBe(false)
    expect(isCertCode("double_booked")).toBe(false)
    expect(isCertCode("")).toBe(false)
  })
})

describe("partitionViolations", () => {
  it("splits cert gaps from advisory codes, preserving order", () => {
    const { cert, advisory } = partitionViolations([
      "overtime",
      "cert_missing:CPR",
      "time_off",
      "cert_missing:First Aid",
    ])
    expect(cert).toEqual(["cert_missing:CPR", "cert_missing:First Aid"])
    expect(advisory).toEqual(["overtime", "time_off"])
  })

  it("handles all-cert, all-advisory, and empty inputs", () => {
    expect(partitionViolations(["cert_missing:CPR"])).toEqual({
      cert: ["cert_missing:CPR"],
      advisory: [],
    })
    expect(partitionViolations(["overtime", "double_booked"])).toEqual({
      cert: [],
      advisory: ["overtime", "double_booked"],
    })
    expect(partitionViolations([])).toEqual({ cert: [], advisory: [] })
  })
})

describe("describeViolation", () => {
  it("formats a cert gap with the cert name", () => {
    expect(describeViolation("cert_missing:CPR")).toBe(
      "requires a certification the employee doesn't have (CPR)"
    )
    // Cert names may contain colons/spaces — only the prefix is stripped.
    expect(describeViolation("cert_missing:Level 2: Ice")).toBe(
      "requires a certification the employee doesn't have (Level 2: Ice)"
    )
  })

  it("uses the known label for a recognized code", () => {
    expect(describeViolation("overtime")).toBe(
      "pushes the employee past the overtime threshold"
    )
    expect(describeViolation("double_booked")).toBe(
      "overlaps another shift this employee is already on"
    )
  })

  it("falls back to the raw code for an unknown code", () => {
    expect(describeViolation("some_future_code")).toBe("some_future_code")
  })
})

describe("formatViolations", () => {
  it("joins descriptions into one sentence", () => {
    expect(formatViolations(["overtime", "cert_missing:CPR"])).toBe(
      "This assignment pushes the employee past the overtime threshold; " +
        "requires a certification the employee doesn't have (CPR)."
    )
  })

  it("handles a single code", () => {
    expect(formatViolations(["time_off"])).toBe(
      "This assignment overlaps approved time off."
    )
  })
})
