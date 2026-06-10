import { describe, expect, it } from "vitest"

import { scrubError, scrubText, SCRUB_MAX_LENGTH } from "./scrub"

describe("scrubText", () => {
  it("masks email addresses", () => {
    expect(scrubText("delivery to pat.lee+ice@rink-mail.co failed")).toBe(
      "delivery to [email] failed",
    )
  })

  it("masks phone numbers in common US formats", () => {
    expect(scrubText("call (555) 010-1234 now")).toBe("call [phone] now")
    expect(scrubText("call 555-010-1234 now")).toBe("call [phone] now")
    expect(scrubText("call +1 555.010.1234 now")).toBe("call [phone] now")
  })

  it("leaves UUIDs and ISO timestamps intact", () => {
    const s =
      "row 6b2f1a40-91c7-4f6e-8a3d-2f9d35c0a111 at 2026-06-10T15:30:00.000Z"
    expect(scrubText(s)).toBe(s)
  })

  it("truncates long messages with an ellipsis", () => {
    const out = scrubText("x".repeat(SCRUB_MAX_LENGTH + 100))
    expect(out).toHaveLength(SCRUB_MAX_LENGTH + 1)
    expect(out.endsWith("…")).toBe(true)
  })

  it("returns empty string for non-strings", () => {
    expect(scrubText(null)).toBe("")
    expect(scrubText(42)).toBe("")
    expect(scrubText(undefined)).toBe("")
  })
})

describe("scrubError", () => {
  it("captures name/message/code/digest from an Error", () => {
    const err = new Error("insert failed for ann@example.com") as Error & {
      code?: string
      digest?: string
    }
    err.code = "23505"
    err.digest = "abc123"
    expect(scrubError(err)).toEqual({
      name: "Error",
      message: "insert failed for [email]",
      code: "23505",
      digest: "abc123",
    })
  })

  it("handles Supabase-style plain-object errors", () => {
    expect(scrubError({ message: "boom", code: "PGRST301" })).toMatchObject({
      name: "NonError",
      message: "boom",
      code: "PGRST301",
    })
  })

  it("never throws on primitives", () => {
    expect(scrubError("nope").message).toBe("nope")
    expect(scrubError(undefined).name).toBe("NonError")
  })
})
