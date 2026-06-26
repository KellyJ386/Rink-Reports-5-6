// Canonical offline-replay retry policy. Pure + unit-tested (retry-policy.test.ts)
// so the rules are pinned with assertions rather than living only inside the
// service worker.
//
// IMPORTANT: public/sw.js cannot import this module (it's a classic service
// worker, not an ES-module worker), so it carries an INLINE COPY of these two
// functions and MAX_REPLAY_RETRIES. If you change the policy here, update the
// mirror in public/sw.js (search "retry-policy.ts") and vice versa — the test
// suite guards this module's half.

/** Max transient retries before a queued submission is parked as "failed". */
export const MAX_REPLAY_RETRIES = 4

// Backoff before the Nth retry (index = retryCount AFTER incrementing, minus 1).
// First retry waits 5s; then 15s, 60s, 300s. Clamped to the last entry.
const RETRY_BACKOFF_MS = [5_000, 15_000, 60_000, 300_000]

// 4xx codes that are actually worth retrying. Everything else in the 4xx range
// means the request itself is wrong (bad payload, no permission, references a
// record that no longer validates) — retrying the identical body will never
// succeed, so we park it immediately. In particular 422 is used for a permanent
// payload-reference failure (e.g. a severity/activity/space deactivated while
// offline) precisely so it is parked rather than retried.
//   401 — session may have expired offline; a re-login refreshes the cookie.
//   408/425/429 — timeout / too-early / rate-limited: back off and retry.
//   409 — generic conflict that may clear on a later attempt (e.g. a transient
//         row conflict); retried.
const TRANSIENT_4XX = new Set([401, 408, 409, 425, 429])

/**
 * Is an HTTP status (or `null` for a network/fetch error) worth retrying?
 * Network errors and 5xx are transient; 4xx is permanent unless allow-listed.
 */
export function isTransientReplayStatus(status: number | null): boolean {
  if (status === null) return true // network error / fetch threw
  if (status >= 500) return true
  if (status >= 400) return TRANSIENT_4XX.has(status)
  return false // 2xx/3xx shouldn't reach here (handled as success)
}

export type ReplayOutcome =
  | { kind: "success" }
  | { kind: "retry"; retryCount: number; nextAttemptAt: number; delayMs: number }
  | { kind: "failed"; retryCount: number; permanent: boolean }

/**
 * Decide what to do with a queued item after one replay attempt.
 *
 * @param ok          response.ok (HTTP 2xx)
 * @param status      HTTP status, or null if fetch threw (offline mid-flight)
 * @param retryCount  attempts already recorded BEFORE this one
 * @param now         current epoch ms (injectable for tests)
 */
export function classifyReplayResult(
  ok: boolean,
  status: number | null,
  retryCount: number,
  now: number,
): ReplayOutcome {
  if (ok) return { kind: "success" }

  // Permanent client error: park immediately, don't burn retries.
  if (!isTransientReplayStatus(status)) {
    return { kind: "failed", retryCount: retryCount + 1, permanent: true }
  }

  const nextCount = retryCount + 1
  if (nextCount > MAX_REPLAY_RETRIES) {
    // Exhausted transient retries — park as failed (recoverable via "Retry").
    return { kind: "failed", retryCount: nextCount, permanent: false }
  }

  const delayMs = RETRY_BACKOFF_MS[Math.min(nextCount - 1, RETRY_BACKOFF_MS.length - 1)]
  return { kind: "retry", retryCount: nextCount, nextAttemptAt: now + delayMs, delayMs }
}
