import { describe, expect, it } from "vitest"

import {
  AQ_LOG_MAX_RANGE_DAYS,
  resolveLogRange,
} from "./log-range"

describe("resolveLogRange", () => {
  it("passes through a valid in-bounds range unchanged", () => {
    const r = resolveLogRange("2026-06-01", "2026-06-30")
    expect(r).toEqual({ from: "2026-06-01", to: "2026-06-30", clamped: false })
  })

  it("clamps a span wider than the cap by moving `from` forward", () => {
    // 2020-01-01 → 2026-06-30 is ~6.5 years, far over the 366-day cap.
    const r = resolveLogRange("2020-01-01", "2026-06-30")
    expect(r.to).toBe("2026-06-30")
    expect(r.clamped).toBe(true)
    // `from` is exactly AQ_LOG_MAX_RANGE_DAYS before `to`.
    const spanDays =
      (Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) /
      86_400_000
    expect(spanDays).toBe(AQ_LOG_MAX_RANGE_DAYS)
  })

  it("does not clamp a span exactly at the cap", () => {
    const to = "2026-06-30"
    const fromMs = Date.parse(`${to}T00:00:00Z`) - AQ_LOG_MAX_RANGE_DAYS * 86_400_000
    const from = new Date(fromMs).toISOString().slice(0, 10)
    const r = resolveLogRange(from, to)
    expect(r.clamped).toBe(false)
    expect(r.from).toBe(from)
  })

  it("falls back to a 90-day lookback when `from` is missing or malformed", () => {
    const r = resolveLogRange(undefined, "2026-06-30")
    expect(r.to).toBe("2026-06-30")
    expect(r.from).toBe("2026-04-01") // 90 days before 06-30
    expect(r.clamped).toBe(false)
  })

  it("recovers from a `from` after `to` by using the default lookback", () => {
    const r = resolveLogRange("2026-07-15", "2026-06-30")
    expect(r.from).toBe("2026-04-01")
    expect(r.to).toBe("2026-06-30")
  })

  it("defaults an invalid `to` to today (shape only)", () => {
    const r = resolveLogRange("2026-06-01", "not-a-date")
    expect(/^\d{4}-\d{2}-\d{2}$/.test(r.to)).toBe(true)
  })
})
