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
export async function checkRateLimit(args: {
  bucket: string
  identifier: string
  max: number
  windowSeconds: number
  failOpen: boolean
}): Promise<boolean> {
  let supabase
  try {
    supabase = createAdminClient()
  } catch {
    // Service-role env missing/misconfigured: never let the limiter itself
    // break the flow — honor the caller's fail direction.
    return args.failOpen
  }

  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_bucket: args.bucket,
    p_identifier: args.identifier,
    p_max: args.max,
    p_window_seconds: args.windowSeconds,
  })
  if (error) return args.failOpen
  return data !== false
}
