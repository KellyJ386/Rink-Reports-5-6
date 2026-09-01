import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Fixed-window rate-limit check, run through the SERVICE-ROLE client.
 *
 * The underlying `check_rate_limit` RPC is SECURITY DEFINER over
 * `rate_limit_counters`; as of migration 216 it is EXECUTE-granted to
 * service_role only, because an anon/authenticated grant let any client
 * increment the counter for an arbitrary (bucket, identifier) — e.g.
 * pre-exhausting a victim's `login_email` window to lock them out. Both real
 * callers (the login action and the public information-requests route) are
 * server-side, so they go through this helper.
 *
 * `failOpen` picks the behavior when the limiter can't run (service-role
 * client unavailable, RPC error): the login path fails OPEN (a limiter blip
 * must never lock everyone out; GoTrue still applies its own caps), the
 * public write path fails CLOSED (an unbounded insert on a limiter outage is
 * worse than briefly turning away retryable leads).
 *
 * Returns true when the action is allowed, false when the limit is exceeded.
 */
/**
 * Three-state limiter result:
 *   - "allowed"     — under the limit, proceed.
 *   - "limited"     — the (bucket, identifier) window is exhausted.
 *   - "unavailable" — the limiter itself could not run (service-role client
 *                     missing/misconfigured, or the RPC errored). Distinct from
 *                     "limited" so a caller can report an accurate 503 instead
 *                     of a misleading "too many requests" — the difference
 *                     matters on a public form where an operator would otherwise
 *                     read a config outage as a rate-limit.
 */
export type RateLimitOutcome = "allowed" | "limited" | "unavailable"

export async function checkRateLimitOutcome(args: {
  bucket: string
  identifier: string
  max: number
  windowSeconds: number
}): Promise<RateLimitOutcome> {
  let supabase
  try {
    supabase = createAdminClient()
  } catch {
    return "unavailable"
  }

  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_bucket: args.bucket,
    p_identifier: args.identifier,
    p_max: args.max,
    p_window_seconds: args.windowSeconds,
  })
  if (error) return "unavailable"
  return data === false ? "limited" : "allowed"
}

/**
 * Boolean allow/deny wrapper over {@link checkRateLimitOutcome}. `failOpen`
 * picks the behavior when the limiter can't run: the login path fails OPEN (a
 * limiter blip must never lock everyone out; GoTrue still applies its own
 * caps), the public write paths fail CLOSED (an unbounded insert on a limiter
 * outage is worse than briefly turning away retryable requests).
 *
 * Returns true when the action is allowed, false when the limit is exceeded.
 * Callers that need to tell an outage apart from a real limit (to send an
 * accurate status) should use {@link checkRateLimitOutcome} directly.
 */
export async function checkRateLimit(args: {
  bucket: string
  identifier: string
  max: number
  windowSeconds: number
  failOpen: boolean
}): Promise<boolean> {
  const outcome = await checkRateLimitOutcome(args)
  if (outcome === "unavailable") return args.failOpen
  return outcome === "allowed"
}
