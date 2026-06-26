import { describe, expect, it } from "vitest"

import {
  classifyReplayResult,
  isTransientReplayStatus,
  MAX_REPLAY_RETRIES,
} from "./retry-policy"

describe("isTransientReplayStatus", () => {
  it("treats network errors (null) as transient", () => {
    expect(isTransientReplayStatus(null)).toBe(true)
  })

  it("treats all 5xx as transient", () => {
    expect(isTransientReplayStatus(500)).toBe(true)
    expect(isTransientReplayStatus(503)).toBe(true)
  })

  it("treats permission/payload 4xx as permanent", () => {
    expect(isTransientReplayStatus(400)).toBe(false)
    expect(isTransientReplayStatus(403)).toBe(false)
    expect(isTransientReplayStatus(404)).toBe(false)
    expect(isTransientReplayStatus(422)).toBe(false)
  })

  it("allow-lists recoverable 4xx (401/408/409/425/429) as transient", () => {
    expect(isTransientReplayStatus(401)).toBe(true)
    expect(isTransientReplayStatus(408)).toBe(true)
    expect(isTransientReplayStatus(409)).toBe(true)
    expect(isTransientReplayStatus(425)).toBe(true)
    expect(isTransientReplayStatus(429)).toBe(true)
  })
})

describe("classifyReplayResult", () => {
  const NOW = 1_000_000

  it("returns success on ok", () => {
    expect(classifyReplayResult(true, 200, 0, NOW)).toEqual({ kind: "success" })
  })

  it("parks a permanent 400 immediately without consuming the retry budget", () => {
    expect(classifyReplayResult(false, 400, 0, NOW)).toEqual({
      kind: "failed",
      retryCount: 1,
      permanent: true,
    })
  })

  it("parks a permanent 403 immediately", () => {
    expect(classifyReplayResult(false, 403, 2, NOW)).toEqual({
      kind: "failed",
      retryCount: 3,
      permanent: true,
    })
  })

  it("parks a 422 payload-reference failure immediately (incident ref mismatch)", () => {
    // The offline-sync route returns 422 when a queued incident references a
    // severity/activity/space that was deactivated while offline — permanent,
    // so it must not burn the transient retry budget.
    expect(classifyReplayResult(false, 422, 0, NOW)).toEqual({
      kind: "failed",
      retryCount: 1,
      permanent: true,
    })
  })

  it("schedules a backoff retry for a 500 with the right delay ladder", () => {
    expect(classifyReplayResult(false, 500, 0, NOW)).toEqual({
      kind: "retry",
      retryCount: 1,
      nextAttemptAt: NOW + 5_000,
      delayMs: 5_000,
    })
    expect(classifyReplayResult(false, 500, 1, NOW)).toEqual({
      kind: "retry",
      retryCount: 2,
      nextAttemptAt: NOW + 15_000,
      delayMs: 15_000,
    })
    expect(classifyReplayResult(false, 503, 2, NOW)).toEqual({
      kind: "retry",
      retryCount: 3,
      nextAttemptAt: NOW + 60_000,
      delayMs: 60_000,
    })
    expect(classifyReplayResult(false, 500, 3, NOW)).toEqual({
      kind: "retry",
      retryCount: 4,
      nextAttemptAt: NOW + 300_000,
      delayMs: 300_000,
    })
  })

  it("treats a network error (null status) as a transient retry", () => {
    expect(classifyReplayResult(false, null, 0, NOW)).toMatchObject({
      kind: "retry",
      retryCount: 1,
    })
  })

  it("parks as non-permanent failed once transient retries are exhausted", () => {
    // retryCount already at the max → the next attempt tips it over.
    expect(classifyReplayResult(false, 500, MAX_REPLAY_RETRIES, NOW)).toEqual({
      kind: "failed",
      retryCount: MAX_REPLAY_RETRIES + 1,
      permanent: false,
    })
  })

  it("clamps the backoff delay at the final ladder entry", () => {
    // At retryCount 3 the next (4th) retry uses the last ladder entry (300s).
    const out = classifyReplayResult(false, 409, 3, NOW)
    expect(out).toEqual({
      kind: "retry",
      retryCount: 4,
      nextAttemptAt: NOW + 300_000,
      delayMs: 300_000,
    })
  })
})
