// Pure decision logic for whether PostHog capture is allowed in the current
// environment (mirrors the email delivery-gate pattern). A dev clone or a
// preview deployment that inherits the production NEXT_PUBLIC_POSTHOG_KEY
// would otherwise pollute production analytics with dev traffic. Capture
// therefore requires a key AND (production environment OR an explicit
// NEXT_PUBLIC_POSTHOG_ENABLED=true opt-in). Unit-tested in gate.test.ts.

export type PosthogGateEnv = {
  /** NEXT_PUBLIC_POSTHOG_KEY — without a key there is nothing to gate. */
  key?: string
  /** NEXT_PUBLIC_POSTHOG_ENABLED — explicit override ("true" / "false"). */
  explicit?: string
  /** (NEXT_PUBLIC_)VERCEL_ENV — "production" | "preview" | "development". */
  vercelEnv?: string
  /** NODE_ENV — fallback when VERCEL_ENV is absent (self-hosted). */
  nodeEnv?: string
}

export type PosthogGate = {
  enabled: boolean
  reason:
    | "no-key"
    | "explicitly-enabled"
    | "explicitly-disabled"
    | "production"
    | "non-production"
}

export function posthogGate(env: PosthogGateEnv): PosthogGate {
  if (!env.key || env.key.trim() === "") {
    return { enabled: false, reason: "no-key" }
  }
  const explicit = env.explicit?.trim().toLowerCase()
  if (explicit === "true") return { enabled: true, reason: "explicitly-enabled" }
  if (explicit === "false") {
    return { enabled: false, reason: "explicitly-disabled" }
  }
  const environment = env.vercelEnv?.trim() || env.nodeEnv?.trim()
  if (environment === "production") {
    return { enabled: true, reason: "production" }
  }
  return { enabled: false, reason: "non-production" }
}
