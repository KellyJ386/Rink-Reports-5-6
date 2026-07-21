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

import { useId, useMemo } from "react"

import {
  buildPerimeterSegments,
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
  /** Glass rows keyed by parent board id (for the glass layer). */
  glassByParent?: Record<string, RinkPerimeterGlass>
  /** Open-issue condition per asset id (assets absent = clear). */
  conditionByAssetId?: Record<string, PerimeterCondition>
  selectedAssetId?: string | null
  onSelectAsset?: (assetId: string) => void
  showGlassLayer?: boolean
  showLabels?: boolean
  className?: string
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
  glassByParent,
  conditionByAssetId,
  selectedAssetId,
  onSelectAsset,
  showGlassLayer = false,
  showLabels = true,
  className,
}: RinkPerimeterProps) {
  const uid = useId()
  const segments = useMemo(
    () => buildPerimeterSegments(positioned, direction),
    [positioned, direction],
  )
  const interactive = typeof onSelectAsset === "function"

  return (
    <div className={className} style={{ aspectRatio: `${RINK_W}/${RINK_H}` }}>
      <svg
        viewBox={`0 0 ${RINK_W} ${RINK_H}`}
        className="h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
        aria-label="Rink perimeter diagram"
      >
        {/* Ice surface — same footprint the boards wrap (matches USARink). */}
        <rect
          x="62.5"
          y="70"
          width="255"
          height="600"
          rx="84"
          ry="84"
          fill="#e8f4f8"
          stroke="#c2d6e0"
          strokeWidth="1"
          pointerEvents="none"
        />
        <line x1="80" y1="370" x2="300" y2="370" stroke="#c8102e" strokeWidth="2.5" opacity="0.35" pointerEvents="none" />
        <circle cx="190" cy="370" r="30" fill="none" stroke="#003087" strokeWidth="1.5" opacity="0.35" pointerEvents="none" />

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
              {/* Enlarged transparent hit area (≥44px touch target). */}
              {interactive && (
                <path
                  d={seg.pathD}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={26}
                  strokeLinecap="round"
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
                      two stubs + a lime door leaf set slightly outward. */}
                  <path
                    d={seg.pathD}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={7}
                    strokeLinecap="round"
                    strokeDasharray="6 100"
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
                    r={7}
                    fill={condition === "alert" ? ALERT_COLOR : WARN_COLOR}
                    stroke="#FFFFFF"
                    strokeWidth={1.25}
                  />
                  <text
                    x={seg.labelAnchor.x}
                    y={seg.labelAnchor.y + 3.2}
                    textAnchor="middle"
                    fontSize={9}
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
                  y={seg.labelAnchor.y + 2.6}
                  textAnchor="middle"
                  fontSize={7.5}
                  className="fill-muted-foreground font-mono"
                  pointerEvents="none"
                >
                  {seg.label}
                </text>
              )}
            </g>
          )
        })}

        {/* Anchor marker: where position 1 starts. */}
        <g pointerEvents="none" aria-hidden="true">
          <circle cx={190} cy={70} r={2.5} fill="#8A92A0" />
          <text
            x={190}
            y={58}
            textAnchor="middle"
            fontSize={7}
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
