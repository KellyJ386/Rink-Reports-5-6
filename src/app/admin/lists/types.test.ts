import { describe, expect, it } from "vitest"

import {
  DOMAINS,
  isDomain,
  isValidTimezone,
  validateDomainKey,
} from "./types"

// These guards are the safety valve that keeps a domain's keys meaningful
// (the DB only enforces uniqueness). They're pure, so they're unit-tested here
// rather than via the SQL harness.

describe("isDomain", () => {
  it("accepts whitelisted domains", () => {
    for (const d of DOMAINS) {
      expect(isDomain(d)).toBe(true)
    }
  })

  it("rejects anything not on the whitelist", () => {
    expect(isDomain("refrigeration_field_type")).toBe(false)
    expect(isDomain("")).toBe(false)
    expect(isDomain("FACILITY_TIMEZONE")).toBe(false)
  })
})

describe("isValidTimezone", () => {
  it("accepts real IANA zones", () => {
    expect(isValidTimezone("America/New_York")).toBe(true)
    expect(isValidTimezone("Pacific/Honolulu")).toBe(true)
    expect(isValidTimezone("UTC")).toBe(true)
  })

  it("rejects bogus or empty zones", () => {
    expect(isValidTimezone("America/Atlantis")).toBe(false)
    expect(isValidTimezone("Eastern")).toBe(false)
    expect(isValidTimezone("")).toBe(false)
  })
})

describe("validateDomainKey", () => {
  it("validates facility_timezone keys as IANA zones", () => {
    expect(validateDomainKey("facility_timezone", "America/Chicago").ok).toBe(
      true,
    )
    const bad = validateDomainKey("facility_timezone", "Not/AZone")
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toMatch(/not a valid IANA time zone/i)
  })
})
