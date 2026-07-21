import { describe, expect, it } from "vitest"

import {
  clamp01,
  isAllowedRinkLogoExtension,
  legendEntries,
  logoBox,
  markerTitle,
  normalizeLogoLayout,
  rinkLogoExtension,
  rinkLogoMimeType,
  type RinkOverlayMarker,
} from "./overlay-shared"

describe("rink logo file validation", () => {
  it("extracts lowercase extensions", () => {
    expect(rinkLogoExtension("Logo.PNG")).toBe("png")
    expect(rinkLogoExtension("a.b.svg")).toBe("svg")
    expect(rinkLogoExtension("noext")).toBe("")
    expect(rinkLogoExtension("trailingdot.")).toBe("")
  })

  it("allows only transparency-capable formats", () => {
    expect(isAllowedRinkLogoExtension("png")).toBe(true)
    expect(isAllowedRinkLogoExtension("svg")).toBe(true)
    expect(isAllowedRinkLogoExtension("webp")).toBe(true)
    expect(isAllowedRinkLogoExtension("jpg")).toBe(false)
    expect(isAllowedRinkLogoExtension("gif")).toBe(false)
    expect(isAllowedRinkLogoExtension("")).toBe(false)
  })

  it("derives mime type from the validated extension", () => {
    expect(rinkLogoMimeType("png")).toBe("image/png")
    expect(rinkLogoMimeType("svg")).toBe("image/svg+xml")
    expect(rinkLogoMimeType("webp")).toBe("image/webp")
    expect(rinkLogoMimeType("exe")).toBe("application/octet-stream")
  })
})

describe("logoBox", () => {
  it("centers a scale-fraction-of-width square on the normalized position", () => {
    const box = logoBox({ position_x: 0.5, position_y: 0.5, scale: 0.25 }, 380, 740)
    expect(box.size).toBeCloseTo(95)
    expect(box.cx).toBeCloseTo(190)
    expect(box.cy).toBeCloseTo(370)
    expect(box.x).toBeCloseTo(190 - 47.5)
    expect(box.y).toBeCloseTo(370 - 47.5)
  })

  it("clamps out-of-range position and scale", () => {
    const box = logoBox({ position_x: 2, position_y: -1, scale: 9 }, 380, 740)
    expect(box.cx).toBe(380)
    expect(box.cy).toBe(0)
    expect(box.size).toBe(380) // scale clamped to 1 × width
  })
})

describe("normalizeLogoLayout", () => {
  it("maps only provided keys to storage columns, clamped", () => {
    expect(normalizeLogoLayout({})).toEqual({})
    expect(
      normalizeLogoLayout({ position_x: 1.5, scale: 0.001, rotation: 720, opacity: -3 }),
    ).toEqual({
      logo_position_x: 1,
      logo_scale: 0.05,
      logo_rotation: 360,
      logo_opacity: 0,
    })
  })

  it("passes in-range values through unchanged", () => {
    expect(
      normalizeLogoLayout({ position_y: 0.4, rotation: -45, opacity: 0.15, scale: 0.3 }),
    ).toEqual({
      logo_position_y: 0.4,
      logo_rotation: -45,
      logo_opacity: 0.15,
      logo_scale: 0.3,
    })
  })

  it("treats non-finite input as the lower bound via clamp", () => {
    expect(clamp01(Number.NaN)).toBe(0)
    expect(normalizeLogoLayout({ opacity: Number.POSITIVE_INFINITY })).toEqual({
      logo_opacity: 1,
    })
  })
})

describe("marker legend", () => {
  const marker = (
    type_name: string,
    color: string,
    label: string | null = null,
  ): RinkOverlayMarker => ({
    id: `${type_name}-${label ?? "x"}`,
    label,
    position_x: 0.5,
    position_y: 0.5,
    type_name,
    color,
  })

  it("builds tooltip titles with and without a label", () => {
    expect(markerTitle(marker("Zamboni Door", "#002244", "West Zamboni"))).toBe(
      "Zamboni Door — West Zamboni",
    )
    expect(markerTitle(marker("Access Door", "#002244"))).toBe("Access Door")
  })

  it("dedupes legend entries per type, counting markers, keeping order", () => {
    const entries = legendEntries([
      marker("Zamboni Door", "#112233", "West"),
      marker("Access Door", "#002244"),
      marker("Zamboni Door", "#112233", "East"),
    ])
    expect(entries).toEqual([
      { type_name: "Zamboni Door", color: "#112233", count: 2 },
      { type_name: "Access Door", color: "#002244", count: 1 },
    ])
  })
})
