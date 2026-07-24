// Read-only rink-diagram overlays: facility logo watermark + door markers.
// Pure presentational SVG fragments — no "use client" directive and no hooks,
// so both server components (done page) and client components (submission
// form, admin editor) can render them inside the shared USARink <svg>.
//
// Z-order contract: callers render <RinkOverlayGroup> through USARink's
// children slot, which sits ABOVE the rink markings and BELOW the depth
// point chips. Within the group the logo renders first (bottom), then door
// markers — the logo can never obscure data.

import React from "react"

import {
  DOOR_MARKER_DEFAULT_COLOR,
  legendEntries,
  logoBox,
  markerTitle,
  nearestDoorSection,
  type RinkLogoOverlay,
  type RinkOverlayMarker,
  type RinkOverlays,
} from "@/lib/ice-depth/overlay-shared"

import { RINK_H, RINK_W, rinkCoords } from "./rink-geometry"

// Door-marker glyph half-diagonal in viewBox units. Deliberately smaller than
// the circular numbered depth chips (r=14) and diamond-shaped so the two read
// as different things at a glance.
const MARKER_R = 8

export function RinkLogoWatermark({ logo }: { logo: RinkLogoOverlay }) {
  const box = logoBox(logo, RINK_W, RINK_H)
  return (
    <image
      href={logo.url}
      x={box.x}
      y={box.y}
      width={box.size}
      height={box.size}
      opacity={logo.opacity}
      preserveAspectRatio="xMidYMid meet"
      transform={
        logo.rotation ? `rotate(${logo.rotation} ${box.cx} ${box.cy})` : undefined
      }
      pointerEvents="none"
      aria-hidden="true"
    />
  )
}

/**
 * Diamond door glyph with a small threshold bar. `selected` draws the
 * admin-editor lime highlight ring — never used on report renders.
 */
export function DoorMarkerGlyph({
  cx,
  cy,
  color,
  title,
  selected = false,
}: {
  cx: number
  cy: number
  color: string
  title?: string
  selected?: boolean
}) {
  const r = MARKER_R
  return (
    <g>
      {title ? <title>{title}</title> : null}
      {selected && (
        <path
          d={`M ${cx} ${cy - r - 4} L ${cx + r + 4} ${cy} L ${cx} ${cy + r + 4} L ${cx - r - 4} ${cy} Z`}
          fill="rgba(77,255,0,0.25)"
          stroke="#4DFF00"
          strokeWidth={1.5}
        />
      )}
      <path
        d={`M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`}
        fill={color}
        stroke="#ffffff"
        strokeWidth={1.5}
      />
      {/* Threshold bar — the non-color cue that this diamond is a door. */}
      <line
        x1={cx - r * 0.45}
        y1={cy}
        x2={cx + r * 0.45}
        y2={cy}
        stroke="#ffffff"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </g>
  )
}

export function RinkDoorMarkers({ markers }: { markers: RinkOverlayMarker[] }) {
  return (
    <g pointerEvents="none">
      {markers.map((m) => {
        const { cx, cy } = rinkCoords(m.position_x, m.position_y)
        const section = nearestDoorSection(m.position_x, m.position_y)
        return (
          <DoorMarkerGlyph
            key={m.id}
            cx={cx}
            cy={cy}
            color={m.color || DOOR_MARKER_DEFAULT_COLOR}
            title={`${markerTitle(m)} (section ${section})`}
          />
        )
      })}
    </g>
  )
}

/** Both overlays in their fixed z-order: logo (bottom), then door markers. */
export function RinkOverlayGroup({ overlays }: { overlays: RinkOverlays }) {
  return (
    <>
      {overlays.logo && <RinkLogoWatermark logo={overlays.logo} />}
      {overlays.markers.length > 0 && (
        <RinkDoorMarkers markers={overlays.markers} />
      )}
    </>
  )
}

/**
 * Compact HTML legend for the door markers (tooltips don't exist on touch).
 * Renders nothing when there are no markers.
 */
export function DoorMarkerLegend({
  markers,
  className,
}: {
  markers: RinkOverlayMarker[]
  className?: string
}) {
  const entries = legendEntries(markers)
  if (entries.length === 0) return null
  return (
    <ul
      className={className}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "6px 14px",
        listStyle: "none",
        margin: 0,
        padding: 0,
      }}
      aria-label="Door marker legend"
    >
      {entries.map((e) => (
        <li
          key={e.type_name}
          className="text-muted-foreground flex items-center gap-1.5 text-xs"
        >
          <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden="true">
            <path
              d="M 8 1 L 15 8 L 8 15 L 1 8 Z"
              fill={e.color}
              stroke="#ffffff"
              strokeWidth={1.5}
            />
          </svg>
          <span>
            {e.type_name}
            {e.count > 1 ? ` ×${e.count}` : ""}
          </span>
        </li>
      ))}
    </ul>
  )
}
