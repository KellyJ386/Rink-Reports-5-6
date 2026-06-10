import { describe, expect, it } from "vitest"

import { posthogGate } from "./gate"

const KEY = "phc_test"

describe("posthogGate", () => {
  it("disabled without a key, regardless of environment or override", () => {
    expect(posthogGate({}).enabled).toBe(false)
    expect(
      posthogGate({ vercelEnv: "production", explicit: "true" }),
    ).toMatchObject({ enabled: false, reason: "no-key" })
    expect(posthogGate({ key: "  " }).reason).toBe("no-key")
  })

  it("explicit override wins in both directions", () => {
    expect(posthogGate({ key: KEY, explicit: "true", vercelEnv: "development" }))
      .toMatchObject({ enabled: true, reason: "explicitly-enabled" })
    expect(posthogGate({ key: KEY, explicit: "false", vercelEnv: "production" }))
      .toMatchObject({ enabled: false, reason: "explicitly-disabled" })
    expect(posthogGate({ key: KEY, explicit: "TRUE", vercelEnv: "preview" }).enabled)
      .toBe(true)
  })

  it("enabled in production (VERCEL_ENV first, NODE_ENV fallback)", () => {
    expect(posthogGate({ key: KEY, vercelEnv: "production" }).enabled).toBe(true)
    expect(posthogGate({ key: KEY, nodeEnv: "production" }).enabled).toBe(true)
    // VERCEL_ENV=preview must NOT fall through to NODE_ENV=production —
    // Vercel preview builds run with NODE_ENV=production.
    expect(
      posthogGate({ key: KEY, vercelEnv: "preview", nodeEnv: "production" }),
    ).toMatchObject({ enabled: false, reason: "non-production" })
  })

  it("disabled in dev/preview without an override", () => {
    expect(posthogGate({ key: KEY, vercelEnv: "development" }).enabled).toBe(false)
    expect(posthogGate({ key: KEY, nodeEnv: "test" }).enabled).toBe(false)
    expect(posthogGate({ key: KEY }).enabled).toBe(false)
  })
})
