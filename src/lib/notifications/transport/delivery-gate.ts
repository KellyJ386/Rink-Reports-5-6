// Pure decision logic for whether outbound email delivery is allowed in the
// current environment. Kept free of server-only imports so it can be
// unit-tested (see delivery-gate.test.ts and the vitest scoping note in
// CLAUDE.md); the server-only transport (email.ts) consumes it.
//
// Why this exists: RESEND_API_KEY alone is not a safe enable switch. A dev
// clone or a Vercel preview deployment that inherits production env vars
// would otherwise send real emails to real staff. Delivery therefore
// requires either running in the production environment or an explicit
// RESEND_ENABLED=true opt-in.

export type EmailDeliveryGateEnv = {
  /** process.env.RESEND_ENABLED — explicit override ("true" / "false"). */
  resendEnabled?: string
  /** process.env.VERCEL_ENV — "production" | "preview" | "development". */
  vercelEnv?: string
  /** process.env.NODE_ENV — fallback when VERCEL_ENV is absent. */
  nodeEnv?: string
}

export type EmailDeliveryGate = {
  enabled: boolean
  /** Stable machine-readable reason, surfaced by /api/health and logs. */
  reason:
    | "explicitly-enabled"
    | "explicitly-disabled"
    | "production"
    | "non-production"
}

/**
 * Decides whether email delivery is permitted.
 *
 * Precedence:
 * 1. RESEND_ENABLED=false  → off (kill switch, even in production).
 * 2. RESEND_ENABLED=true   → on  (explicit opt-in, e.g. staging email QA).
 * 3. Otherwise on only when the deployment environment is production.
 *    VERCEL_ENV is preferred over NODE_ENV because Vercel preview builds
 *    run with NODE_ENV=production but VERCEL_ENV=preview.
 */
export function resolveEmailDeliveryGate(
  env: EmailDeliveryGateEnv,
): EmailDeliveryGate {
  const flag = env.resendEnabled?.trim().toLowerCase()
  if (flag === "false") {
    return { enabled: false, reason: "explicitly-disabled" }
  }
  if (flag === "true") {
    return { enabled: true, reason: "explicitly-enabled" }
  }

  const deployEnv = env.vercelEnv?.trim().toLowerCase() || env.nodeEnv
  if (deployEnv === "production") {
    return { enabled: true, reason: "production" }
  }
  return { enabled: false, reason: "non-production" }
}
