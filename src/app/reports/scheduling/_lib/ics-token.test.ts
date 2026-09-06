import { describe, expect, it } from "vitest"

import { hashIcsToken, newIcsToken } from "./ics-token"

describe("newIcsToken", () => {
  it("returns 48 lowercase hex chars (over the DB's 32-char floor)", () => {
    const token = newIcsToken()
    expect(token).toMatch(/^[0-9a-f]{48}$/)
  })

  it("returns a fresh value each call", () => {
    expect(newIcsToken()).not.toEqual(newIcsToken())
  })
})

describe("hashIcsToken", () => {
  it("computes the SHA-256 hex digest (pinned vector)", () => {
    // sha256("abc") — FIPS 180-2 test vector. The migration-278 backfill
    // (encode(sha256(convert_to(token,'UTF8')),'hex')) must produce the same
    // digest for the same input, or every pre-rotation feed URL breaks.
    expect(hashIcsToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    )
  })

  it("is deterministic and 64 hex chars (satisfies the length>=32 CHECK)", () => {
    const token = newIcsToken()
    const digest = hashIcsToken(token)
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    expect(hashIcsToken(token)).toBe(digest)
  })

  it("never echoes the plaintext", () => {
    const token = newIcsToken()
    expect(hashIcsToken(token)).not.toContain(token)
  })
})
