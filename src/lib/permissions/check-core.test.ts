import { describe, expect, it } from "vitest"

import { permissionFromRpc } from "./check-core"

describe("permissionFromRpc", () => {
  it("grants only on an exact true with no error", () => {
    expect(permissionFromRpc({ data: true, error: null })).toBe(true)
  })

  it("denies on any error, even if data says true", () => {
    expect(
      permissionFromRpc({ data: true, error: { message: "boom" } }),
    ).toBe(false)
    expect(permissionFromRpc({ data: null, error: new Error("x") })).toBe(false)
  })

  it("denies on false, null, and undefined data", () => {
    expect(permissionFromRpc({ data: false, error: null })).toBe(false)
    expect(permissionFromRpc({ data: null, error: null })).toBe(false)
    expect(permissionFromRpc({ data: undefined, error: null })).toBe(false)
  })

  it("denies on truthy non-boolean data (fail closed on malformed results)", () => {
    expect(permissionFromRpc({ data: "true", error: null })).toBe(false)
    expect(permissionFromRpc({ data: 1, error: null })).toBe(false)
    expect(permissionFromRpc({ data: {}, error: null })).toBe(false)
    expect(permissionFromRpc({ data: [true], error: null })).toBe(false)
  })
})
