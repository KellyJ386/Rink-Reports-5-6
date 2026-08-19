import { describe, expect, it } from "vitest"

import {
  resolveEmailDeliveryGate,
  resolveEmailRecipient,
} from "./delivery-gate"

describe("resolveEmailDeliveryGate", () => {
  it("disables delivery in plain development", () => {
    expect(
      resolveEmailDeliveryGate({ nodeEnv: "development" }),
    ).toEqual({ enabled: false, reason: "non-production" })
  })

  it("enables delivery in production (NODE_ENV, no Vercel)", () => {
    expect(resolveEmailDeliveryGate({ nodeEnv: "production" })).toEqual({
      enabled: true,
      reason: "production",
    })
  })

  it("enables delivery on Vercel production", () => {
    expect(
      resolveEmailDeliveryGate({
        vercelEnv: "production",
        nodeEnv: "production",
      }),
    ).toEqual({ enabled: true, reason: "production" })
  })

  it("disables delivery on Vercel preview even though NODE_ENV is production", () => {
    // Vercel preview deployments inherit env vars and build with
    // NODE_ENV=production; VERCEL_ENV is the truthful signal.
    expect(
      resolveEmailDeliveryGate({
        vercelEnv: "preview",
        nodeEnv: "production",
      }),
    ).toEqual({ enabled: false, reason: "non-production" })
  })

  it("RESEND_ENABLED=true force-enables outside production", () => {
    expect(
      resolveEmailDeliveryGate({
        resendEnabled: "true",
        vercelEnv: "preview",
        nodeEnv: "production",
      }),
    ).toEqual({ enabled: true, reason: "explicitly-enabled" })
  })

  it("RESEND_ENABLED=false force-disables even in production", () => {
    expect(
      resolveEmailDeliveryGate({
        resendEnabled: "false",
        vercelEnv: "production",
        nodeEnv: "production",
      }),
    ).toEqual({ enabled: false, reason: "explicitly-disabled" })
  })

  it("treats flag values case-insensitively and trims whitespace", () => {
    expect(
      resolveEmailDeliveryGate({ resendEnabled: " TRUE ", nodeEnv: "test" })
        .enabled,
    ).toBe(true)
    expect(
      resolveEmailDeliveryGate({
        resendEnabled: " False ",
        vercelEnv: "production",
      }).enabled,
    ).toBe(false)
  })

  it("ignores unrecognized flag values and falls back to environment", () => {
    expect(
      resolveEmailDeliveryGate({ resendEnabled: "yes", nodeEnv: "development" }),
    ).toEqual({ enabled: false, reason: "non-production" })
    expect(
      resolveEmailDeliveryGate({ resendEnabled: "1", vercelEnv: "production" }),
    ).toEqual({ enabled: true, reason: "production" })
  })

  it("handles a fully empty environment by disabling delivery", () => {
    expect(resolveEmailDeliveryGate({})).toEqual({
      enabled: false,
      reason: "non-production",
    })
  })
})

describe("resolveEmailRecipient", () => {
  const base = { to: "staff@rink.example", sinkRecipient: "sink@example.com" }

  it("delivers to the real recipient in production (the sink must never swallow production mail)", () => {
    expect(
      resolveEmailRecipient({
        ...base,
        vercelEnv: "production",
        nodeEnv: "production",
      }),
    ).toBe("staff@rink.example")
    expect(resolveEmailRecipient({ ...base, nodeEnv: "production" })).toBe(
      "staff@rink.example",
    )
  })

  it("redirects to the sink on Vercel preview even though NODE_ENV is production", () => {
    expect(
      resolveEmailRecipient({
        ...base,
        vercelEnv: "preview",
        nodeEnv: "production",
      }),
    ).toBe("sink@example.com")
  })

  it("redirects to the sink in development and in an empty environment", () => {
    expect(resolveEmailRecipient({ ...base, nodeEnv: "development" })).toBe(
      "sink@example.com",
    )
    expect(resolveEmailRecipient(base)).toBe("sink@example.com")
  })
})
