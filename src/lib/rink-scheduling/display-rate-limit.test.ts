import { describe, expect, it } from "vitest"

import {
  consumeRateLimit,
  displayRateLimitKey,
  pruneStore,
  type RateLimitStore,
} from "./display-rate-limit"

const OPTS = { limit: 3, windowMs: 60_000 }

function store(): RateLimitStore {
  return new Map()
}

describe("consumeRateLimit", () => {
  it("allows requests up to the limit", () => {
    const s = store()
    expect(consumeRateLimit(s, "k", 0, OPTS).allowed).toBe(true)
    expect(consumeRateLimit(s, "k", 10, OPTS).allowed).toBe(true)
    expect(consumeRateLimit(s, "k", 20, OPTS).allowed).toBe(true)
  })

  it("denies the request that exceeds the limit", () => {
    const s = store()
    for (let i = 0; i < 3; i++) consumeRateLimit(s, "k", i, OPTS)
    expect(consumeRateLimit(s, "k", 30, OPTS).allowed).toBe(false)
  })

  it("counts down remaining and floors it at zero", () => {
    const s = store()
    expect(consumeRateLimit(s, "k", 0, OPTS).remaining).toBe(2)
    expect(consumeRateLimit(s, "k", 1, OPTS).remaining).toBe(1)
    expect(consumeRateLimit(s, "k", 2, OPTS).remaining).toBe(0)
    expect(consumeRateLimit(s, "k", 3, OPTS).remaining).toBe(0)
  })

  it("keeps separate budgets per key", () => {
    const s = store()
    for (let i = 0; i < 3; i++) consumeRateLimit(s, "a", i, OPTS)
    expect(consumeRateLimit(s, "a", 4, OPTS).allowed).toBe(false)
    expect(consumeRateLimit(s, "b", 4, OPTS).allowed).toBe(true)
  })

  it("starts a fresh window once the old one has elapsed", () => {
    const s = store()
    for (let i = 0; i < 4; i++) consumeRateLimit(s, "k", 0, OPTS)
    expect(consumeRateLimit(s, "k", 59_999, OPTS).allowed).toBe(false)
    expect(consumeRateLimit(s, "k", 60_000, OPTS).allowed).toBe(true)
  })

  it("reports a usable Retry-After that shrinks through the window", () => {
    const s = store()
    expect(consumeRateLimit(s, "k", 0, OPTS).retryAfterSeconds).toBe(60)
    expect(consumeRateLimit(s, "k", 30_000, OPTS).retryAfterSeconds).toBe(30)
    // Never zero: a Retry-After of 0 invites an immediate retry.
    expect(consumeRateLimit(s, "k", 59_999, OPTS).retryAfterSeconds).toBe(1)
  })

  it("treats a limit below one as a limit of one", () => {
    const s = store()
    expect(consumeRateLimit(s, "k", 0, { limit: 0, windowMs: 1000 }).allowed).toBe(true)
    expect(consumeRateLimit(s, "k", 1, { limit: 0, windowMs: 1000 }).allowed).toBe(false)
  })

  it("does not let a denied request extend the window", () => {
    const s = store()
    for (let i = 0; i < 5; i++) consumeRateLimit(s, "k", 100, OPTS)
    // Window still began at t=100, so it still reopens at 60_100.
    expect(consumeRateLimit(s, "k", 60_100, OPTS).allowed).toBe(true)
  })

  it("keeps counting within one window even as time advances", () => {
    const s = store()
    consumeRateLimit(s, "k", 0, OPTS)
    consumeRateLimit(s, "k", 20_000, OPTS)
    consumeRateLimit(s, "k", 40_000, OPTS)
    expect(consumeRateLimit(s, "k", 50_000, OPTS).allowed).toBe(false)
  })
})

describe("pruneStore", () => {
  it("leaves the store alone while it is under the cap", () => {
    const s = store()
    s.set("old", { windowStartMs: 0, count: 1 })
    pruneStore(s, 10_000_000, 60_000, 10)
    expect(s.size).toBe(1)
  })

  it("drops only closed windows once over the cap", () => {
    const s = store()
    s.set("old", { windowStartMs: 0, count: 1 })
    s.set("fresh", { windowStartMs: 100_000, count: 1 })
    pruneStore(s, 100_000, 60_000, 1)
    expect([...s.keys()]).toEqual(["fresh"])
  })

  it("is reached through consumeRateLimit when a new window opens", () => {
    const s = store()
    s.set("stale", { windowStartMs: 0, count: 1 })
    s.set("stale2", { windowStartMs: 0, count: 1 })
    // maxKeys 1, and this call opens a new window for "k" -> prune runs.
    consumeRateLimit(s, "k", 500_000, { ...OPTS, maxKeys: 1 })
    expect(s.has("stale")).toBe(false)
    expect(s.has("k")).toBe(true)
  })

  it("does not prune when an existing window is merely reused", () => {
    const s = store()
    consumeRateLimit(s, "k", 0, { ...OPTS, maxKeys: 0 })
    s.set("stale", { windowStartMs: 0, count: 1 })
    consumeRateLimit(s, "k", 10, { ...OPTS, maxKeys: 0 })
    expect(s.has("stale")).toBe(true)
  })
})

describe("displayRateLimitKey", () => {
  it("namespaces the token hash", () => {
    expect(displayRateLimitKey("abc")).toBe("t:abc")
  })

  it("separates two tokens", () => {
    expect(displayRateLimitKey("a")).not.toBe(displayRateLimitKey("b"))
  })
})
