import { describe, expect, it } from "vitest"

import { safeRedirectPath } from "./safe-redirect"

// Pure open-redirect guard for the post-login `redirectTo` param and the
// email-callback `next` param. Unit-tested here (rather than the SQL harness)
// because it's dependency-free logic.

describe("safeRedirectPath", () => {
  it("accepts a plain absolute path", () => {
    expect(safeRedirectPath("/reports/daily")).toBe("/reports/daily")
    expect(safeRedirectPath("/dashboard")).toBe("/dashboard")
    expect(safeRedirectPath("/")).toBe("/")
  })

  it("preserves query string and fragment", () => {
    expect(safeRedirectPath("/reports?tab=open#top")).toBe(
      "/reports?tab=open#top",
    )
  })

  it("trims surrounding whitespace", () => {
    expect(safeRedirectPath("  /dashboard  ")).toBe("/dashboard")
  })

  it("keeps percent-encoded backslashes as literal path characters", () => {
    // "%5c" is not decoded by the URL parser, so this stays on-origin.
    expect(safeRedirectPath("/%5cevil.example")).toBe("/%5cevil.example")
  })

  it("rejects protocol-relative URLs", () => {
    expect(safeRedirectPath("//evil.com")).toBeNull()
    expect(safeRedirectPath("//evil.com/path")).toBeNull()
    expect(safeRedirectPath("///evil.com")).toBeNull()
  })

  it("rejects the backslash protocol-relative variants", () => {
    expect(safeRedirectPath("/\\evil.com")).toBeNull()
    expect(safeRedirectPath("/\\/evil.com")).toBeNull()
    expect(safeRedirectPath("/\\\\evil.com")).toBeNull()
  })

  it("rejects a backslash anywhere in the path", () => {
    expect(safeRedirectPath("/reports\\daily")).toBeNull()
  })

  it("rejects absolute URLs with a scheme", () => {
    expect(safeRedirectPath("https://evil.com")).toBeNull()
    expect(safeRedirectPath("http://evil.com/x")).toBeNull()
  })

  it("rejects paths that are not absolute", () => {
    expect(safeRedirectPath("dashboard")).toBeNull()
    expect(safeRedirectPath("reports/daily")).toBeNull()
    expect(safeRedirectPath("javascript:alert(1)")).toBeNull()
  })

  it("rejects control/whitespace smuggling of a scheme or host", () => {
    expect(safeRedirectPath("/\tjavascript:alert(1)")).toBeNull()
    expect(safeRedirectPath("/\njavascript:alert(1)")).toBeNull()
    // The URL parser strips tab/CR/LF, so these would parse as "//evil.com".
    expect(safeRedirectPath("/\t/evil.com")).toBeNull()
    expect(safeRedirectPath("/\r\n/evil.com")).toBeNull()
  })

  it("rejects empty, non-string, and whitespace-only input", () => {
    expect(safeRedirectPath("")).toBeNull()
    expect(safeRedirectPath("   ")).toBeNull()
    expect(safeRedirectPath(null)).toBeNull()
    expect(safeRedirectPath(undefined)).toBeNull()
    expect(safeRedirectPath(42)).toBeNull()
    expect(safeRedirectPath({})).toBeNull()
    expect(safeRedirectPath([])).toBeNull()
  })

  it("guarantees accepted values resolve on the caller's origin", () => {
    const origin = "https://rink-reports.example"
    for (const candidate of [
      "/dashboard",
      "/reports?tab=open#top",
      "/%5cevil.example",
      "/admin/employees/abc-123?edit=1",
    ]) {
      const accepted = safeRedirectPath(candidate)
      expect(accepted).not.toBeNull()
      expect(new URL(accepted!, origin).origin).toBe(origin)
    }
  })
})
