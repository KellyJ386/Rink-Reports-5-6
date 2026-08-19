import { describe, expect, it } from "vitest"

import { authorizeCronRequest } from "./authorize"

const SECRET = "s3cret-value"

describe("authorizeCronRequest", () => {
  it("accepts the exact Bearer header", () => {
    expect(authorizeCronRequest(`Bearer ${SECRET}`, SECRET)).toBe(true)
  })

  it("rejects a missing or empty header", () => {
    expect(authorizeCronRequest(null, SECRET)).toBe(false)
    expect(authorizeCronRequest(undefined, SECRET)).toBe(false)
    expect(authorizeCronRequest("", SECRET)).toBe(false)
  })

  it("rejects a wrong secret, a missing scheme, and a wrong scheme", () => {
    expect(authorizeCronRequest("Bearer wrong", SECRET)).toBe(false)
    expect(authorizeCronRequest(SECRET, SECRET)).toBe(false)
    expect(authorizeCronRequest(`Basic ${SECRET}`, SECRET)).toBe(false)
  })

  it("rejects everything when no secret is configured", () => {
    // A blank CRON_SECRET must never authorize — otherwise a misconfigured
    // deployment would silently accept `Bearer ` from anyone.
    expect(authorizeCronRequest("Bearer ", "")).toBe(false)
    expect(authorizeCronRequest("Bearer anything", "")).toBe(false)
  })

  it("is not fooled by a prefix or a longer header", () => {
    expect(authorizeCronRequest(`Bearer ${SECRET}extra`, SECRET)).toBe(false)
    expect(authorizeCronRequest(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false)
  })
})
