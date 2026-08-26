// Fixed-window rate limiting for the public display endpoint.
//
// WHY THIS EXISTS. /api/display/[token] is the module's only unauthenticated
// endpoint, and it resolves a bearer token against the database. Two distinct
// abuses need bounding:
//
//   - Guessing. A wrong token still costs a hashed lookup. `isPlausibleDisplayToken`
//     turns junk into a free 404, but a well-formed guess does hit the DB.
//   - Hammering. A lobby TV polls every `refresh_seconds` (>= 15). Anything
//     polling far faster is a misconfigured kiosk or a scraper, and one TV
//     should not be able to spend the whole facility's query budget.
//
// WHY IN-PROCESS AND NOT A SHARED STORE. This is a best-effort cap, not a
// security boundary — the security boundary is the 256-bit token itself. On
// serverless each instance keeps its own counter, so the effective global
// limit is (instances x limit); that is fine for the job, and it costs no
// extra infrastructure. Stated here so nobody mistakes it for a strict quota.
//
// The clock is injected and the store is passed in, so this file is pure and
// vitest can drive it without timers.

export type RateLimitBucket = {
  /** Start of the current window, in ms. */
  windowStartMs: number
  count: number
}

export type RateLimitStore = Map<string, RateLimitBucket>

export type RateLimitDecision = {
  allowed: boolean
  /** Requests left in this window after accounting for the current one. */
  remaining: number
  /** Whole seconds until the window resets. Always >= 1 so it is a usable
   *  Retry-After value. */
  retryAfterSeconds: number
}

export type RateLimitOptions = {
  /** Requests permitted per window. */
  limit: number
  /** Window length in ms. */
  windowMs: number
  /** Evict buckets older than this many windows when the store grows. Keeps an
   *  attacker rotating keys from growing the map without bound. */
  maxKeys?: number
}

const DEFAULT_MAX_KEYS = 5_000

/**
 * Count one request against `key` and say whether it may proceed.
 *
 * Mutates `store`, which the caller owns (module-scope Map in the route). A
 * request arriving exactly on the window boundary starts the new window.
 */
export function consumeRateLimit(
  store: RateLimitStore,
  key: string,
  nowMs: number,
  options: RateLimitOptions,
): RateLimitDecision {
  const limit = Math.max(1, Math.floor(options.limit))
  const windowMs = Math.max(1, Math.floor(options.windowMs))

  const existing = store.get(key)
  const expired = !existing || nowMs - existing.windowStartMs >= windowMs

  const bucket: RateLimitBucket = expired
    ? { windowStartMs: nowMs, count: 0 }
    : existing

  bucket.count += 1
  store.set(key, bucket)

  if (expired) pruneStore(store, nowMs, windowMs, options.maxKeys ?? DEFAULT_MAX_KEYS)

  const elapsed = nowMs - bucket.windowStartMs
  return {
    allowed: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: Math.max(1, Math.ceil((windowMs - elapsed) / 1000)),
  }
}

/**
 * Drop buckets whose window has closed, but only once the store is over
 * `maxKeys` — the common case is a handful of TVs and should not pay for a
 * sweep on every request.
 */
export function pruneStore(
  store: RateLimitStore,
  nowMs: number,
  windowMs: number,
  maxKeys: number,
): void {
  if (store.size <= maxKeys) return
  for (const [key, bucket] of store) {
    if (nowMs - bucket.windowStartMs >= windowMs) store.delete(key)
  }
}

/**
 * Rate-limit key for a request.
 *
 * Keyed on the token, not the client IP: a facility's TVs may sit behind one
 * NAT, and the abuse worth bounding ("this token is being polled far too
 * often") is per-token by nature. An IP cycling through *different* guessed
 * tokens is bounded by the separate `unknown-token` bucket the route uses.
 */
export function displayRateLimitKey(tokenHash: string): string {
  return `t:${tokenHash}`
}
