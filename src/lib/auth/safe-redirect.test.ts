import { describe, expect, it } from "vitest"

import { safeRedirectPath } from "./safe-redirect"

describe("safeRedirectPath", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/reports/daily", "/reports/daily"],
    ["/reports?tab=open#top", "/reports?tab=open#top"],
    ["//evil.example", null],
    ["/\\evil.example", null],
    ["/\\/evil.example", null],
    ["/%5cevil.example", "/%5cevil.example"],
    ["https://evil.example", null],
    ["javascript:alert(1)", null],
    ["dashboard", null],
    [" /dashboard ", null],
    ["/\tjavascript:alert(1)", null],
    ["/\njavascript:alert(1)", null],
    ["", null],
  ])("validates %j", (candidate, expected) => {
    expect(safeRedirectPath(candidate)).toBe(expected)
  })

  it.each([null, undefined, 42, {}, []])("rejects non-string input %j", (value) => {
    expect(safeRedirectPath(value)).toBeNull()
  })

  it("guarantees accepted values resolve on the caller's origin", () => {
    const origin = "https://rink-reports.example"
    const accepted = safeRedirectPath("/reports?tab=open#top")

    expect(accepted).not.toBeNull()
    expect(new URL(accepted!, origin).origin).toBe(origin)
  })
})
