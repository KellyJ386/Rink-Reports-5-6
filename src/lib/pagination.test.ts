import { describe, expect, it } from "vitest"

import { clampShow, nextShow, SHOW_MAX_DEFAULT } from "./pagination"

const opts = { initial: 200 }

describe("clampShow", () => {
  it("defaults to initial for missing or non-numeric values", () => {
    expect(clampShow(undefined, opts)).toBe(200)
    expect(clampShow("", opts)).toBe(200)
    expect(clampShow("abc", opts)).toBe(200)
  })

  it("never goes below initial (negative, zero, small values)", () => {
    expect(clampShow("0", opts)).toBe(200)
    expect(clampShow("-50", opts)).toBe(200)
    expect(clampShow("10", opts)).toBe(200)
  })

  it("passes through in-range values and caps at max", () => {
    expect(clampShow("400", opts)).toBe(400)
    expect(clampShow("999999", opts)).toBe(SHOW_MAX_DEFAULT)
    expect(clampShow("999999", { initial: 200, max: 600 })).toBe(600)
  })

  it("tolerates trailing junk the way parseInt does", () => {
    expect(clampShow("400abc", opts)).toBe(400)
  })
})

describe("nextShow", () => {
  it("steps by initial when no step given", () => {
    expect(nextShow(200, opts)).toBe(400)
  })

  it("honors an explicit step", () => {
    expect(nextShow(200, { initial: 200, step: 100 })).toBe(300)
  })

  it("clamps the last step to max and then stops", () => {
    expect(nextShow(500, { initial: 200, max: 600 })).toBe(600)
    expect(nextShow(600, { initial: 200, max: 600 })).toBeNull()
    expect(nextShow(SHOW_MAX_DEFAULT, opts)).toBeNull()
  })
})
