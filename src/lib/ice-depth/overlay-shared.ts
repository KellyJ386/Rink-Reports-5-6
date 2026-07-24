// Shared constants + pure helpers for the Ice Depth rink-diagram overlays
// (door markers + center-ice logo watermark). Framework agnostic — imported by
// server actions, report pages, and client components; keep it free of
// "server-only" / "use client" imports so vitest can unit-test it directly.
//
// Both overlays live in the SAME normalized coordinate space as
// ice_depth_points: fractions in [0,1] against the 380×740 rink viewBox
// (see src/components/ice-depth/rink-geometry.ts). No second coordinate
// system exists.

import {
  PERIMETER_LENGTH,
  perimeterNormalAt,
  perimeterPointAt,
} from "@/components/rink/perimeter-geometry"

// Brand tokens for the overlay layer. Navy is the default door-marker color
// (when a door type has no color of its own); lime is reserved for the
// active/selected marker in the admin editor so selection never collides with
// per-type colors.
export const DOOR_MARKER_DEFAULT_COLOR = "#002244"
export const DOOR_MARKER_SELECTED_COLOR = "#4DFF00"

// Logo upload constraints. Transparency-capable raster/vector formats only.
export const MAX_RINK_LOGO_BYTES = 2 * 1024 * 1024 // 2 MB

export const ALLOWED_RINK_LOGO_EXTENSIONS = ["png", "svg", "webp"] as const

const RINK_LOGO_MIME_TYPES: Record<
  (typeof ALLOWED_RINK_LOGO_EXTENSIONS)[number],
  string
> = {
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
}

export function rinkLogoExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".")
  if (dot < 0 || dot === fileName.length - 1) return ""
  return fileName.slice(dot + 1).toLowerCase()
}

export function isAllowedRinkLogoExtension(
  ext: string,
): ext is (typeof ALLOWED_RINK_LOGO_EXTENSIONS)[number] {
  return (ALLOWED_RINK_LOGO_EXTENSIONS as readonly string[]).includes(ext)
}

/** Content-type derived from the VALIDATED extension, never file.type. */
export function rinkLogoMimeType(ext: string): string {
  return isAllowedRinkLogoExtension(ext)
    ? RINK_LOGO_MIME_TYPES[ext]
    : "application/octet-stream"
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

// Logo layout bounds — mirror the CHECK constraints on
// facility_rink_diagram_config (migration 199).
export const LOGO_SCALE_MIN = 0.05
export const LOGO_SCALE_MAX = 1
export const LOGO_ROTATION_MIN = -360
export const LOGO_ROTATION_MAX = 360

/** Layout values as rendered (and as stored — same units). */
export type RinkLogoLayout = {
  position_x: number
  position_y: number
  /** Fraction of the diagram WIDTH the logo box occupies. */
  scale: number
  /** Degrees, applied around the logo box center. */
  rotation: number
  opacity: number
}

/**
 * Resolve the logo's square bounding box in viewBox pixels. The box is
 * `scale × rinkWidth` on a side, centered on the normalized position; the
 * image letter-boxes inside it (preserveAspectRatio meet), so non-square
 * logos keep their aspect ratio.
 */
export function logoBox(
  layout: Pick<RinkLogoLayout, "position_x" | "position_y" | "scale">,
  rinkWidth: number,
  rinkHeight: number,
): { x: number; y: number; size: number; cx: number; cy: number } {
  const size = clamp(layout.scale, LOGO_SCALE_MIN, LOGO_SCALE_MAX) * rinkWidth
  const cx = clamp01(layout.position_x) * rinkWidth
  const cy = clamp01(layout.position_y) * rinkHeight
  return { x: cx - size / 2, y: cy - size / 2, size, cx, cy }
}

/** Normalize a raw layout patch to the stored bounds (server + client share this). */
export function normalizeLogoLayout(patch: {
  position_x?: number
  position_y?: number
  scale?: number
  rotation?: number
  opacity?: number
}): {
  logo_position_x?: number
  logo_position_y?: number
  logo_scale?: number
  logo_rotation?: number
  logo_opacity?: number
} {
  const out: ReturnType<typeof normalizeLogoLayout> = {}
  if (typeof patch.position_x === "number") {
    out.logo_position_x = clamp01(patch.position_x)
  }
  if (typeof patch.position_y === "number") {
    out.logo_position_y = clamp01(patch.position_y)
  }
  if (typeof patch.scale === "number") {
    out.logo_scale = clamp(patch.scale, LOGO_SCALE_MIN, LOGO_SCALE_MAX)
  }
  if (typeof patch.rotation === "number") {
    out.logo_rotation = clamp(patch.rotation, LOGO_ROTATION_MIN, LOGO_ROTATION_MAX)
  }
  if (typeof patch.opacity === "number") {
    out.logo_opacity = clamp01(patch.opacity)
  }
  return out
}

// ---------------------------------------------------------------------------
// Perimeter door sections
//
// Doors live on the boards, so placement works like the Dasher Boards
// perimeter: the SAME rounded-rectangle boundary (perimeter-geometry.ts) is
// divided into DOOR_SECTION_COUNT equal numbered sections, walked CLOCKWISE
// from the top-edge midpoint (section 1 — matching dasher's "pos 1" anchor).
// The admin picks a section; the marker is stored as the section midpoint in
// the ordinary normalized 0..1 coordinate space, so report/PDF rendering and
// the DB schema are unchanged, and pre-section markers keep working (they
// display as their NEAREST section).
// ---------------------------------------------------------------------------

export const DOOR_SECTION_COUNT = 24

export type DoorSection = {
  /** 1-based section number, clockwise from the top-edge midpoint. */
  number: number
  startS: number
  endS: number
  midS: number
  /** Section midpoint on the boundary, normalized to the 0..1 space. */
  position_x: number
  position_y: number
}

export function doorSections(count = DOOR_SECTION_COUNT): DoorSection[] {
  const span = PERIMETER_LENGTH / count
  return Array.from({ length: count }, (_, i) => {
    const startS = span * i
    const endS = span * (i + 1)
    const midS = (startS + endS) / 2
    const mid = perimeterPointAt(midS)
    return {
      number: i + 1,
      startS,
      endS,
      midS,
      position_x: mid.x / 380,
      position_y: mid.y / 740,
    }
  })
}

/** Stored coordinates for a door placed in section `number`. */
export function sectionPosition(
  number: number,
  count = DOOR_SECTION_COUNT,
): { position_x: number; position_y: number } {
  const sections = doorSections(count)
  const section =
    sections[Math.min(Math.max(1, Math.round(number)), count) - 1]
  return { position_x: section.position_x, position_y: section.position_y }
}

/**
 * Nearest section for an arbitrary stored position (legacy free-placed
 * markers, drag releases). Projects the point onto the boundary by sampled
 * arc-length search, then buckets into the section grid.
 */
export function nearestDoorSection(
  position_x: number,
  position_y: number,
  count = DOOR_SECTION_COUNT,
): number {
  const px = clamp01(position_x) * 380
  const py = clamp01(position_y) * 740
  const step = 2
  let bestS = 0
  let bestD = Number.POSITIVE_INFINITY
  for (let s = 0; s < PERIMETER_LENGTH; s += step) {
    const p = perimeterPointAt(s)
    const d = (p.x - px) * (p.x - px) + (p.y - py) * (p.y - py)
    if (d < bestD) {
      bestD = d
      bestS = s
    }
  }
  const span = PERIMETER_LENGTH / count
  return (Math.floor(bestS / span) % count) + 1
}

/**
 * SVG path for a section's span along the boundary (admin ring rendering).
 * `gap` trims arc length at both ends so adjacent sections read as separate
 * segments; `offset` shifts the polyline along the outward normal.
 */
export function sectionPathD(
  section: Pick<DoorSection, "startS" | "endS">,
  gap = 2,
  offset = 0,
): string {
  const s0 = section.startS + gap / 2
  const s1 = section.endS - gap / 2
  const n = Math.max(2, Math.ceil((s1 - s0) / 4))
  const pts: string[] = []
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n
    const p = perimeterPointAt(s)
    if (offset !== 0) {
      const nrm = perimeterNormalAt(s)
      pts.push(
        `${(p.x + nrm.x * offset).toFixed(2)} ${(p.y + nrm.y * offset).toFixed(2)}`,
      )
    } else {
      pts.push(`${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    }
  }
  return `M ${pts[0]} L ${pts.slice(1).join(" L ")}`
}

/** Outward label anchor for a section's number chip. */
export function sectionLabelAnchor(
  section: Pick<DoorSection, "midS">,
  offset = 16,
): { x: number; y: number } {
  const p = perimeterPointAt(section.midS)
  const nrm = perimeterNormalAt(section.midS)
  return { x: p.x + nrm.x * offset, y: p.y + nrm.y * offset }
}

/** Marker + resolved presentation data, shared by report + admin renderers. */
export type RinkOverlayMarker = {
  id: string
  label: string | null
  position_x: number
  position_y: number
  type_name: string
  /** Resolved door-type color (falls back to brand navy). */
  color: string
}

export type RinkLogoOverlay = RinkLogoLayout & {
  /** Signed URL (short-lived) for the facility's logo object. */
  url: string
}

export type RinkOverlays = {
  markers: RinkOverlayMarker[]
  logo: RinkLogoOverlay | null
}

/** Tooltip / legend text for a marker: "Type — Label" or just the type. */
export function markerTitle(marker: Pick<RinkOverlayMarker, "type_name" | "label">): string {
  return marker.label ? `${marker.type_name} — ${marker.label}` : marker.type_name
}

/**
 * Distinct legend entries (one per door type present), in first-appearance
 * order of the marker list (which callers sort by type sort_order).
 */
export function legendEntries(
  markers: readonly RinkOverlayMarker[],
): Array<{ type_name: string; color: string; count: number }> {
  const byType = new Map<string, { type_name: string; color: string; count: number }>()
  for (const m of markers) {
    const existing = byType.get(m.type_name)
    if (existing) existing.count += 1
    else byType.set(m.type_name, { type_name: m.type_name, color: m.color, count: 1 })
  }
  return Array.from(byType.values())
}
