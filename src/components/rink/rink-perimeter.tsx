"use client"

// Dasher Boards perimeter diagram — a SIBLING of the Ice Depth USARink
// component (deliberately not shared code: ice-depth's diagram is
// WCAG-tuned and offline-critical, so its regression surface stays at zero).
// Draws the same 380×740 ice surface, then the ordered ring of board/door
// segments around it.
//
// Color contract (product decision): red (#F42A2A) and yellow (#FFD600) are
// RESERVED for condition state — open severity-A and open B/C issues
// respectively. A door's at-rest identity is the lime accent (#4DFF00) plus a
// break in the board line; it is never red or yellow unless it has open
// issues. Non-color cues: doors get a glyph, condition gets a "!" marker.

import { useId, useMemo, useRef } from "react"

import { RinkMarkings } from "@/components/ice-depth/usa-rink"

import {
  boundaryPathD,
  buildPerimeterSegments,
  nearestArcLength,
  perimeterNormalAt,
  perimeterPointAt,
  PERIMETER_LENGTH,
  RINK_H,
  RINK_W,
  type PerimeterDirection,
  type PerimeterSegment,
  type PositionedAssetLite,
} from "./perimeter-geometry"

export type PerimeterCondition = "warn" | "alert"

export type RinkPerimeterGlass = {
  id: string
  label: string
  parentBoardId: string
  isActive: boolean
  hasSpec: boolean
}

export type RinkPerimeterProps = {
  /** Active positioned assets (boards + doors) in sequence order. */
  positioned: PositionedAssetLite[]
  direction: PerimeterDirection
  /**
   * Where sequence position 1 starts drawing, as a fraction [0, 1) of the
   * boundary's arc length (the rink's `perimeter_anchor_offset`). Purely a
   * rendering rotation — never changes which asset is which. Default 0 =
   * top-middle, the historical fixed start.
   */
  anchorOffsetFraction?: number
  /** Glass rows keyed by parent board id (for the glass layer). */
  glassByParent?: Record<string, RinkPerimeterGlass>
  /** Open-issue condition per asset id (assets absent = clear). */
  conditionByAssetId?: Record<string, PerimeterCondition>
  selectedAssetId?: string | null
  onSelectAsset?: (assetId: string) => void
  showGlassLayer?: boolean
  showLabels?: boolean
  className?: string
  /**
   * When set, the diagram enters "pick a start point" mode: the whole
   * boundary becomes a click target, and clicking anywhere on it reports the
   * nearest arc-length fraction. Admin-only (see PerimeterTab's "Set start
   * point" toggle) — staff-facing renders never pass this.
   */
  onPickAnchor?: (offsetFraction: number) => void
}

const BOARD_COLOR = "#33475e"
const DOOR_COLOR = "#4DFF00"
const DOOR_INK = "#1A9B00"
const SELECT_COLOR = "#4DFF00"
const WARN_COLOR = "#FFD600"
const ALERT_COLOR = "#F42A2A"
const GLASS_COLOR = "#5aa9d6"

function segmentStroke(
  seg: PerimeterSegment,
  condition: PerimeterCondition | undefined,
): string {
  if (condition === "alert") return ALERT_COLOR
  if (condition === "warn") return WARN_COLOR
  return seg.assetType === "door" ? DOOR_COLOR : BOARD_COLOR
}

export function RinkPerimeter({
  positioned,
  direction,
  anchorOffsetFraction = 0,
  glassByParent,
  conditionByAssetId,
  selectedAssetId,
  onSelectAsset,
  showGlassLayer = false,
  showLabels = true,
  className,
  onPickAnchor,
}: RinkPerimeterProps) {
  const uid = useId()
  const svgRef = useRef<SVGSVGElement>(null)
  const anchorOffset = anchorOffsetFraction * PERIMETER_LENGTH
  const segments = useMemo(
    () => buildPerimeterSegments(positioned, direction, anchorOffset),
    [positioned, direction, anchorOffset],
  )
  const interactive = typeof onSelectAsset === "function"
  const pickingAnchor = typeof onPickAnchor === "function"
  const anchorPoint = perimeterPointAt(anchorOffset)
  const anchorNormal = perimeterNormalAt(anchorOffset)
  const anchorCaption = {
    x: anchorPoint.x + anchorNormal.x * 26,
    y: anchorPoint.y + anchorNormal.y * 26,
  }

  function handleBoundaryClick(e: React.PointerEvent<SVGPathElement>) {
    const svg = svgRef.current
    if (!svg || !onPickAnchor) return
    const ctm = svg.getScreenCTM()
    if (!ctm) return
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const local = pt.matrixTransform(ctm.inverse())
    const s = nearestArcLength({ x: local.x, y: local.y })
    onPickAnchor(s / PERIMETER_LENGTH)
  }

  return (
    <div className={className} style={{ aspectRatio: `${RINK_W}/${RINK_H}` }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${RINK_W} ${RINK_H}`}
        className={pickingAnchor ? "h-auto w-full cursor-crosshair" : "h-auto w-full"}
        preserveAspectRatio="xMidYMid meet"
        aria-label="Rink perimeter diagram"
      >
        {/* The SAME USA Hockey ice surface the Ice Depth diagram renders
            (shared markup, imported) — the board ring wraps around it.
            pointer-events off so markings never steal the segments' taps. */}
        <g pointerEvents="none" aria-hidden="true">
          <RinkMarkings />
        </g>

        {/* "Pick a start point" hit target — the whole boundary, so it works
            even before any assets exist (the wizard's empty-ring preview).
            Wide transparent stroke for an easy tap target; a thin dashed
            highlight underneath signals the mode is active. */}
        {pickingAnchor && (
          <>
            <path
              d={boundaryPathD()}
              fill="none"
              stroke={SELECT_COLOR}
              strokeWidth={2}
              strokeDasharray="4 4"
              opacity={0.5}
              pointerEvents="none"
            />
            <path
              d={boundaryPathD()}
              fill="none"
              stroke="transparent"
              strokeWidth={28}
              role="button"
              aria-label="Click a spot on the boundary to set the perimeter start point"
              onPointerDown={handleBoundaryClick}
            />
          </>
        )}

        {/* Glass layer (inside the boards). */}
        {showGlassLayer &&
          segments.map((seg) => {
            const glass =
              seg.assetType === "board_panel"
                ? glassByParent?.[seg.assetId]
                : undefined
            if (seg.assetType === "door") return null
            return (
              <path
                key={`glass-${seg.assetId}`}
                d={seg.glassPathD}
                fill="none"
                stroke={GLASS_COLOR}
                strokeWidth={glass?.isActive ? 2.5 : 1.25}
                strokeDasharray={glass?.isActive ? undefined : "3 4"}
                opacity={glass ? (glass.isActive ? 0.9 : 0.4) : 0.15}
                strokeLinecap="round"
                pointerEvents="none"
              />
            )
          })}

        {/* Board / door segments. */}
        {segments.map((seg) => {
          const condition = conditionByAssetId?.[seg.assetId]
          const selected = selectedAssetId === seg.assetId
          const stroke = segmentStroke(seg, condition)
          const isDoor = seg.assetType === "door"
          return (
            <g
              key={seg.assetId}
              {...(interactive
                ? {
                    role: "button",
                    tabIndex: 0,
                    "aria-label": `${isDoor ? "Door" : "Board panel"} ${seg.label}${
                      condition === "alert"
                        ? ", open severity A issue"
                        : condition === "warn"
                          ? ", open issue"
                          : ""
                    }`,
                    onClick: () => onSelectAsset?.(seg.assetId),
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        onSelectAsset?.(seg.assetId)
                      }
                    },
                    className: "cursor-pointer focus:outline-none",
                  }
                : {})}
            >
              {/* Enlarged transparent hit area. Butt caps so a segment's hit
                  zone never extends past its own span and steals the
                  neighbor's taps; 34 SVG units of stroke ≈ the full board
                  band + margin at typical phone render widths. Keyboard
                  selection (Tab + Enter) covers precision taps at high
                  position counts, where per-segment width is physics-bound. */}
              {interactive && (
                <path
                  d={seg.pathD}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={34}
                  strokeLinecap="butt"
                />
              )}
              {/* Selection halo. */}
              {selected && (
                <path
                  d={seg.pathD}
                  fill="none"
                  stroke={SELECT_COLOR}
                  strokeWidth={12}
                  strokeLinecap="round"
                  opacity={0.35}
                />
              )}
              {isDoor ? (
                <>
                  {/* Door identity: a deliberate break in the board line —
                      two board-colored stubs (one at EACH end, via a
                      normalized pathLength so the dash pattern spans the
                      whole segment exactly once) + a lime door leaf. */}
                  <path
                    d={seg.pathD}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={7}
                    strokeLinecap="round"
                    pathLength={100}
                    strokeDasharray="12 76"
                  />
                  <path
                    d={seg.pathD}
                    fill="none"
                    stroke={condition ? stroke : DOOR_COLOR}
                    strokeWidth={7}
                    strokeLinecap="butt"
                    // Leaf: the middle ~60% of the span only.
                    pathLength={100}
                    strokeDasharray="60 100"
                    strokeDashoffset={-20}
                  />
                  {/* Door glyph (non-color cue): hinge dot at the span mid. */}
                  <circle
                    cx={seg.mid.x}
                    cy={seg.mid.y}
                    r={3}
                    fill={condition ? "#FFFFFF" : DOOR_INK}
                    stroke={condition ? stroke : DOOR_INK}
                    strokeWidth={1.5}
                    pointerEvents="none"
                  />
                </>
              ) : (
                <path
                  d={seg.pathD}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={7}
                  strokeLinecap="round"
                />
              )}
              {/* Condition marker (non-color cue): "!" chip outward of span. */}
              {condition && (
                <g pointerEvents="none">
                  <circle
                    cx={seg.labelAnchor.x}
                    cy={seg.labelAnchor.y}
                    r={9}
                    fill={condition === "alert" ? ALERT_COLOR : WARN_COLOR}
                    stroke="#FFFFFF"
                    strokeWidth={1.25}
                  />
                  <text
                    x={seg.labelAnchor.x}
                    y={seg.labelAnchor.y + 3.8}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={800}
                    fill={condition === "alert" ? "#FFFFFF" : "#002244"}
                  >
                    !
                  </text>
                </g>
              )}
              {/* Label (Space Mono via the app's mono font stack). */}
              {showLabels && !condition && (
                <text
                  x={seg.labelAnchor.x}
                  y={seg.labelAnchor.y + 3.6}
                  textAnchor="middle"
                  fontSize={10.5}
                  fontWeight={600}
                  className="fill-muted-foreground font-mono"
                  pointerEvents="none"
                >
                  {seg.label}
                </text>
              )}
            </g>
          )
        })}

        {/* Anchor marker: where position 1 starts — the facility-settable
            start point (default top-middle). Offset further outward than the
            label ring so it never collides with the top-edge asset labels,
            wherever on the ring it sits. */}
        <g pointerEvents="none" aria-hidden="true">
          <circle cx={anchorPoint.x} cy={anchorPoint.y} r={2.5} fill="#8A92A0" />
          <text
            x={anchorCaption.x}
            y={anchorCaption.y}
            textAnchor="middle"
            fontSize={9}
            className="fill-muted-foreground font-mono"
          >
            {`pos 1 ${direction === "clockwise" ? "→" : "←"}`}
          </text>
        </g>
        <title id={`${uid}-title`}>Rink perimeter</title>
      </svg>
    </div>
  )
}
