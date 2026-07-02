import { describe, expect, it } from "vitest"

import { isSafeRedirectPath } from "./redirect-safe"

// Pure open-redirect guard for the post-login `redirectTo` param. Unit-tested
// here (rather than the SQL harness) because it's dependency-free logic.

describe("isSafeRedirectPath", () => {
  it("accepts a plain absolute path", () => {
    expect(isSafeRedirectPath("/reports/daily")).toBe("/reports/daily")
    expect(isSafeRedirectPath("/dashboard")).toBe("/dashboard")
  })

  it("preserves query string and fragment", () => {
    expect(isSafeRedirectPath("/reports?tab=open#top")).toBe(
      "/reports?tab=open#top",
    )
  })

  it("trims surrounding whitespace", () => {
    expect(isSafeRedirectPath("  /dashboard  ")).toBe("/dashboard")
  })

  it("rejects protocol-relative URLs", () => {
    expect(isSafeRedirectPath("//evil.com")).toBeNull()
    expect(isSafeRedirectPath("//evil.com/path")).toBeNull()
  })

  it("rejects the backslash protocol-relative variant", () => {
    expect(isSafeRedirectPath("/\\evil.com")).toBeNull()
  })

  it("rejects absolute URLs with a scheme", () => {
    expect(isSafeRedirectPath("https://evil.com")).toBeNull()
    expect(isSafeRedirectPath("http://evil.com/x")).toBeNull()
  })

  it("rejects paths that are not absolute", () => {
    expect(isSafeRedirectPath("dashboard")).toBeNull()
    expect(isSafeRedirectPath("reports/daily")).toBeNull()
    expect(isSafeRedirectPath("javascript:alert(1)")).toBeNull()
  })

  it("rejects control/whitespace smuggling of a scheme", () => {
    expect(isSafeRedirectPath("/\tjavascript:alert(1)")).toBeNull()
    expect(isSafeRedirectPath("/\njavascript:alert(1)")).toBeNull()
  })

  it("rejects empty, non-string, and whitespace-only input", () => {
    expect(isSafeRedirectPath("")).toBeNull()
    expect(isSafeRedirectPath("   ")).toBeNull()
    expect(isSafeRedirectPath(null)).toBeNull()
    expect(isSafeRedirectPath(undefined)).toBeNull()
    expect(isSafeRedirectPath(42)).toBeNull()
  })
})
