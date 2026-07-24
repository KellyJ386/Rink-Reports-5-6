import { describe, expect, it } from "vitest"

import {
  DOOR_SECTION_COUNT,
  clamp01,
  doorSections,
  isAllowedRinkLogoExtension,
  legendEntries,
  logoBox,
  markerTitle,
  nearestDoorSection,
  normalizeLogoLayout,
  rinkLogoExtension,
  rinkLogoMimeType,
  sectionPathD,
  sectionPosition,
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

describe("perimeter door sections", () => {
  it("divides the boundary into DOOR_SECTION_COUNT contiguous numbered spans", () => {
    const sections = doorSections()
    expect(sections).toHaveLength(DOOR_SECTION_COUNT)
    expect(sections[0].number).toBe(1)
    expect(sections[DOOR_SECTION_COUNT - 1].number).toBe(DOOR_SECTION_COUNT)
    for (let i = 1; i < sections.length; i++) {
      expect(sections[i].startS).toBeCloseTo(sections[i - 1].endS, 6)
    }
  })

  it("starts section 1 just clockwise of the top-edge midpoint (dasher anchor)", () => {
    const [first] = doorSections()
    expect(first.startS).toBe(0)
    // Midpoint of section 1 sits on the top edge, right of center.
    expect(first.position_y).toBeCloseTo(70 / 740, 5)
    expect(first.position_x).toBeGreaterThan(0.5)
  })

  it("keeps every section midpoint on the board line, inside the 0..1 space", () => {
    for (const s of doorSections()) {
      expect(s.position_x).toBeGreaterThanOrEqual(62.5 / 380)
      expect(s.position_x).toBeLessThanOrEqual(317.5 / 380)
      expect(s.position_y).toBeGreaterThanOrEqual(70 / 740)
      expect(s.position_y).toBeLessThanOrEqual(670 / 740)
    }
  })

  it("round-trips: a section's own stored position maps back to that section", () => {
    for (const s of doorSections()) {
      const pos = sectionPosition(s.number)
      expect(nearestDoorSection(pos.position_x, pos.position_y)).toBe(s.number)
    }
  })

  it("clamps out-of-range section numbers in sectionPosition", () => {
    expect(sectionPosition(0)).toEqual(sectionPosition(1))
    expect(sectionPosition(999)).toEqual(sectionPosition(DOOR_SECTION_COUNT))
  })

  it("buckets an off-boundary (legacy free-placed) marker to the nearest section", () => {
    // A point just inside the ice near the top-right corner should land in an
    // early clockwise section, not wrap around the whole ring.
    const n = nearestDoorSection(0.8, 0.12)
    expect(n).toBeGreaterThanOrEqual(2)
    expect(n).toBeLessThanOrEqual(5)
  })

  it("builds a drawable span path", () => {
    const [first] = doorSections()
    const d = sectionPathD(first)
    expect(d.startsWith("M ")).toBe(true)
    expect(d).toContain(" L ")
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
