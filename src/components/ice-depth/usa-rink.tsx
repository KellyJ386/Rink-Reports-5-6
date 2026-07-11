"use client"

// USA Hockey rink diagram — shared component used by submission form, admin
// layout editor, and session detail. viewBox is 380 × 740 (portrait).
//
// Point coordinates stored in the DB as x_position/y_position (0..1) map to
// SVG space via: cx = x_position * 380, cy = y_position * 740.
// The rink interior runs x: 62.5–317.5, y: 70–670, so valid ice positions
// sit in roughly x_pos ∈ [0.16, 0.84] and y_pos ∈ [0.09, 0.91].

import React from "react"

import { cn } from "@/lib/utils"

import {
  RINK_H,
  RINK_W,
  rinkCoords,
  type PointChipState,
  type RinkPointSpec,
} from "./rink-geometry"

// Re-export so existing `import { ... } from "@/components/ice-depth/usa-rink"`
// statements in client code keep working. Server code should import the
// helpers from "@/components/ice-depth/rink-geometry" directly to avoid
// crossing a client boundary (Next.js wraps client-module exports as
// client references, which throw when called from server components).
export { RINK_H, RINK_W, rinkCoords }
export type { PointChipState, RinkPointSpec }

// ---------------------------------------------------------------------------
// USA Hockey rink SVG markings
//
// Scale: 3 units per foot. Rink interior: x 62.5–317.5, y 70–670.
// All positions derived from USA Hockey rulebook measurements:
//   - Goal line: 11 ft from end boards
//   - Blue line: 64 ft from goal line (75 ft from boards)
//   - Center line: solid red (not dashed)
//   - End zone face-off circles: 20 ft from goal line, 22 ft from centerline
//   - Neutral zone face-off dots: 5 ft from blue line toward center
//   - Face-off circle radius: 15 ft
//   - Crease: 6 ft radius D-shape
//   - Goal: 6 ft wide × 3.33 ft deep, posts 3 ft each side of center
// ---------------------------------------------------------------------------

const S = 3 // units per foot
const RINK_LEFT = 62.5
const RINK_RIGHT = 317.5
const RINK_TOP = 70
const RINK_BOTTOM = 670
const CENTER_X = 190
const CENTER_Y = 370

const GOAL_TOP = RINK_TOP + 11 * S    // 103
const GOAL_BOT = RINK_BOTTOM - 11 * S // 637
const BLUE_TOP = GOAL_TOP + 64 * S    // 295
const BLUE_BOT = GOAL_BOT - 64 * S    // 445

const POST_L = CENTER_X - 3 * S  // 181
const POST_R = CENTER_X + 3 * S  // 199
const NET_DEPTH = Math.round(3.33 * S) // 10
const CREASE_R = 6 * S   // 18
const CIRCLE_R = 15 * S  // 45

const END_FO_TOP = GOAL_TOP + 20 * S  // 163
const END_FO_BOT = GOAL_BOT - 20 * S  // 577
const FO_X_L = CENTER_X - 22 * S     // 124
const FO_X_R = CENTER_X + 22 * S     // 256

const NEUTRAL_TOP = BLUE_TOP + 5 * S  // 310
const NEUTRAL_BOT = BLUE_BOT - 5 * S  // 430

const TRAP_GOAL_L = POST_L - 6 * S   // 163 (6 ft outside left post)
const TRAP_GOAL_R = POST_R + 6 * S   // 217
const TRAP_BOARD_L = CENTER_X - 14 * S // 148 (14 ft from center at boards)
const TRAP_BOARD_R = CENTER_X + 14 * S // 232

function EndZoneFaceoffCircle({ fx, fy }: { fx: number; fy: number }) {
  // Outer hash marks extend horizontally outward from the left/right of the circle
  const hOff = 6   // y-offset from circle center for hash pair
  const hExt = 8   // length of hash line extending beyond circle
  // Inner L-shaped restraining marks in each quadrant
  const lxOff = 4  // x distance from center to L-shape vertical leg
  const lyOff = 8  // y distance from center to L-shape horizontal leg
  const lW = 9     // L horizontal arm length
  const lL = 12    // L vertical arm length (away from center dot)

  return (
    <g>
      <circle cx={fx} cy={fy} r={CIRCLE_R} fill="none" stroke="#cc0000" strokeWidth="1.5" />
      <circle cx={fx} cy={fy} r={4} fill="#cc0000" />

      {/* Outer hash marks: horizontal lines outside left and right of circle */}
      <line x1={fx - CIRCLE_R} y1={fy - hOff} x2={fx - CIRCLE_R - hExt} y2={fy - hOff} stroke="#cc0000" strokeWidth="1.5" />
      <line x1={fx - CIRCLE_R} y1={fy + hOff} x2={fx - CIRCLE_R - hExt} y2={fy + hOff} stroke="#cc0000" strokeWidth="1.5" />
      <line x1={fx + CIRCLE_R} y1={fy - hOff} x2={fx + CIRCLE_R + hExt} y2={fy - hOff} stroke="#cc0000" strokeWidth="1.5" />
      <line x1={fx + CIRCLE_R} y1={fy + hOff} x2={fx + CIRCLE_R + hExt} y2={fy + hOff} stroke="#cc0000" strokeWidth="1.5" />

      {/* Inner L-shaped restraining marks (one per quadrant) */}
      {/* Upper-left */}
      <line x1={fx - lxOff} y1={fy - lyOff} x2={fx - lxOff - lW} y2={fy - lyOff} stroke="#cc0000" strokeWidth="1.5" />
      <line x1={fx - lxOff} y1={fy - lyOff} x2={fx - lxOff} y2={fy - lyOff - lL} stroke="#cc0000" strokeWidth="1.5" />
      {/* Upper-right */}
      <line x1={fx + lxOff} y1={fy - lyOff} x2={fx + lxOff + lW} y2={fy - lyOff} stroke="#cc0000" strokeWidth="1.5" />
      <line x1={fx + lxOff} y1={fy - lyOff} x2={fx + lxOff} y2={fy - lyOff - lL} stroke="#cc0000" strokeWidth="1.5" />
      {/* Lower-left */}
      <line x1={fx - lxOff} y1={fy + lyOff} x2={fx - lxOff - lW} y2={fy + lyOff} stroke="#cc0000" strokeWidth="1.5" />
      <line x1={fx - lxOff} y1={fy + lyOff} x2={fx - lxOff} y2={fy + lyOff + lL} stroke="#cc0000" strokeWidth="1.5" />
      {/* Lower-right */}
      <line x1={fx + lxOff} y1={fy + lyOff} x2={fx + lxOff + lW} y2={fy + lyOff} stroke="#cc0000" strokeWidth="1.5" />
      <line x1={fx + lxOff} y1={fy + lyOff} x2={fx + lxOff} y2={fy + lyOff + lL} stroke="#cc0000" strokeWidth="1.5" />
    </g>
  )
}

function RinkMarkings() {
  return (
    <>
      <defs>
        <pattern id="rr-net" x="0" y="0" width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M 0 0 L 6 6 M 6 0 L 0 6" stroke="#999" strokeWidth="0.5" fill="none" />
        </pattern>
        <clipPath id="rr-logo-clip">
          <circle cx="190" cy="370" r="43" />
        </clipPath>
      </defs>

      {/* Ice surface */}
      <rect x="62.5" y="70" width="255" height="600" rx="84" ry="84"
        fill="#e8f4f8" stroke="#333" strokeWidth="2" />

      {/* Goal lines */}
      <line x1="80" y1={GOAL_TOP} x2="300" y2={GOAL_TOP} stroke="#cc0000" strokeWidth="2" />
      <line x1="80" y1={GOAL_BOT} x2="300" y2={GOAL_BOT} stroke="#cc0000" strokeWidth="2" />

      {/* Blue lines (64 ft from each goal line) */}
      <line x1={RINK_LEFT} y1={BLUE_TOP} x2={RINK_RIGHT} y2={BLUE_TOP} stroke="#003087" strokeWidth="4" />
      <line x1={RINK_LEFT} y1={BLUE_BOT} x2={RINK_RIGHT} y2={BLUE_BOT} stroke="#003087" strokeWidth="4" />

      {/* Center red line (solid) */}
      <line x1={RINK_LEFT} y1={CENTER_Y} x2={RINK_RIGHT} y2={CENTER_Y} stroke="#c8102e" strokeWidth="4" />

      {/* Goals (nets behind goal lines, away from center ice) */}
      <rect x={POST_L} y={GOAL_TOP - NET_DEPTH} width={POST_R - POST_L} height={NET_DEPTH}
        fill="url(#rr-net)" stroke="#cc0000" strokeWidth="1.5" />
      <rect x={POST_L} y={GOAL_BOT} width={POST_R - POST_L} height={NET_DEPTH}
        fill="url(#rr-net)" stroke="#cc0000" strokeWidth="1.5" />

      {/* Goal post dots */}
      <circle cx={POST_L} cy={GOAL_TOP} r="2.5" fill="#cc0000" />
      <circle cx={POST_R} cy={GOAL_TOP} r="2.5" fill="#cc0000" />
      <circle cx={POST_L} cy={GOAL_BOT} r="2.5" fill="#cc0000" />
      <circle cx={POST_R} cy={GOAL_BOT} r="2.5" fill="#cc0000" />

      {/* Goal creases — 6 ft radius D-shape, bulging toward center ice */}
      <path d={`M ${CENTER_X - CREASE_R} ${GOAL_TOP} A ${CREASE_R} ${CREASE_R} 0 0 1 ${CENTER_X + CREASE_R} ${GOAL_TOP}`}
        fill="#a8d4f0" stroke="#cc0000" strokeWidth="1.5" />
      <path d={`M ${CENTER_X - CREASE_R} ${GOAL_BOT} A ${CREASE_R} ${CREASE_R} 0 0 0 ${CENTER_X + CREASE_R} ${GOAL_BOT}`}
        fill="#a8d4f0" stroke="#cc0000" strokeWidth="1.5" />

      {/* Trapezoid restricted-area lines */}
      <line x1={TRAP_GOAL_L} y1={GOAL_TOP} x2={TRAP_BOARD_L} y2={RINK_TOP} stroke="#cc0000" strokeWidth="1.5" />
      <line x1={TRAP_GOAL_R} y1={GOAL_TOP} x2={TRAP_BOARD_R} y2={RINK_TOP} stroke="#cc0000" strokeWidth="1.5" />
      <line x1={TRAP_GOAL_L} y1={GOAL_BOT} x2={TRAP_BOARD_L} y2={RINK_BOTTOM} stroke="#cc0000" strokeWidth="1.5" />
      <line x1={TRAP_GOAL_R} y1={GOAL_BOT} x2={TRAP_BOARD_R} y2={RINK_BOTTOM} stroke="#cc0000" strokeWidth="1.5" />

      {/* Center face-off circle (blue) */}
      <circle cx={CENTER_X} cy={CENTER_Y} r={CIRCLE_R} fill="none" stroke="#003087" strokeWidth="2" />
      <circle cx={CENTER_X} cy={CENTER_Y} r={4} fill="#003087" />

      {/* Neutral-zone face-off spots (5 ft inside blue lines) */}
      {([
        [FO_X_L, NEUTRAL_TOP], [FO_X_R, NEUTRAL_TOP],
        [FO_X_L, NEUTRAL_BOT], [FO_X_R, NEUTRAL_BOT],
      ] as [number, number][]).map(([fx, fy], i) => (
        <g key={i}>
          <circle cx={fx} cy={fy} r={4} fill="#c8102e" />
          <circle cx={fx} cy={fy} r={7} fill="none" stroke="#c8102e" strokeWidth="1.5" />
        </g>
      ))}

      {/* End-zone face-off circles (4) */}
      <EndZoneFaceoffCircle fx={FO_X_L} fy={END_FO_TOP} />
      <EndZoneFaceoffCircle fx={FO_X_R} fy={END_FO_TOP} />
      <EndZoneFaceoffCircle fx={FO_X_L} fy={END_FO_BOT} />
      <EndZoneFaceoffCircle fx={FO_X_R} fy={END_FO_BOT} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Individual point chip
// ---------------------------------------------------------------------------

const CHIP_R = 14

function PointChip({
  pointNumber,
  cx,
  cy,
  state,
  doneColor,
  severity,
  depthValue,
  onClick,
  showValues,
}: RinkPointSpec & { showValues?: boolean }) {
  const [focused, setFocused] = React.useState(false)
  const isCurrent = state === "current"
  const isDone = state === "done"
  const isInactive = state === "inactive"

  const fill = isDone ? (doneColor ?? "#16a34a") : isCurrent ? "#002244" : "#ffffff"
  const stroke = isCurrent ? "#4DFF00" : isDone ? (doneColor ?? "#16a34a") : "#333333"
  const textFill = isDone || isCurrent ? "#ffffff" : "#111111"
  const opacity = isInactive ? 0.4 : 1
  // Non-color severity cue for out-of-range done points (WCAG 1.4.1).
  const outOfRange = isDone && (severity === "low" || severity === "high")

  return (
    <g
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      onFocus={onClick ? () => setFocused(true) : undefined}
      onBlur={onClick ? () => setFocused(false) : undefined}
      style={{ cursor: onClick ? "pointer" : "default", outline: "none" }}
      opacity={opacity}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `Select measurement point ${pointNumber}` : undefined}
    >
      {/* Keyboard focus ring — browser default outlines on SVG elements are
          inconsistent, so draw an explicit high-contrast ring. */}
      {focused && (
        <circle
          cx={cx}
          cy={cy}
          r={CHIP_R + 4}
          fill="none"
          stroke="var(--ring)"
          strokeWidth={3}
        />
      )}
      {/* Enlarged transparent hit target (~44px on a phone-width render) so the
          tap target clears WCAG 2.5.8 without growing the visible chip. */}
      {onClick && (
        <circle cx={cx} cy={cy} r={22} fill="transparent" />
      )}

      {/* Glow ring for current point */}
      {isCurrent && (
        <circle
          cx={cx}
          cy={cy}
          r={CHIP_R + 7}
          fill="rgba(105,190,40,0.25)"
          stroke="rgba(105,190,40,0.6)"
          strokeWidth="1.5"
        />
      )}

      <circle
        cx={cx}
        cy={cy}
        r={CHIP_R}
        fill={fill}
        stroke={stroke}
        strokeWidth={isCurrent ? 2.5 : 1.5}
      />

      {/* Non-color severity badge: ▲ above target / ▼ below min. Sits at the
          chip's top edge with a white halo so it reads on any fill. Redundant
          with the fill color, so colorblind users still get the signal. */}
      {outOfRange && (
        <g aria-hidden="true">
          <circle cx={cx + CHIP_R * 0.8} cy={cy - CHIP_R * 0.8} r={5.5} fill="#ffffff" stroke="#333333" strokeWidth={0.75} />
          <path
            d={
              severity === "high"
                ? `M ${cx + CHIP_R * 0.8} ${cy - CHIP_R * 0.8 - 2.6} L ${cx + CHIP_R * 0.8 + 2.4} ${cy - CHIP_R * 0.8 + 1.8} L ${cx + CHIP_R * 0.8 - 2.4} ${cy - CHIP_R * 0.8 + 1.8} Z`
                : `M ${cx + CHIP_R * 0.8} ${cy - CHIP_R * 0.8 + 2.6} L ${cx + CHIP_R * 0.8 + 2.4} ${cy - CHIP_R * 0.8 - 1.8} L ${cx + CHIP_R * 0.8 - 2.4} ${cy - CHIP_R * 0.8 - 1.8} Z`
            }
            fill="#111111"
          />
        </g>
      )}

      {/* Once measured (history / session-detail mode), the dot shows its depth
          value instead of the point index. Unmeasured points keep their number. */}
      {showValues && isDone && depthValue != null ? (
        <text
          x={cx}
          y={cy + 3.5}
          textAnchor="middle"
          fontSize={10}
          fontWeight={700}
          fill={textFill}
          style={{
            userSelect: "none",
            fontFamily: "var(--font-geist-mono), monospace",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {depthValue % 1 === 0 ? depthValue.toString() : depthValue.toFixed(1)}
        </text>
      ) : (
        <text
          x={cx}
          y={cy + 4}
          textAnchor="middle"
          fontSize={11}
          fontWeight={700}
          fill={textFill}
          style={{ userSelect: "none", fontFamily: "system-ui, sans-serif" }}
        >
          {pointNumber}
        </text>
      )}
    </g>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface USARinkProps {
  points: RinkPointSpec[]
  /** Show depth values inside done chips (history / session detail mode). */
  showValues?: boolean
  /** URL of a logo image to display at center ice inside the center faceoff circle. */
  logoUrl?: string | null
  className?: string
  style?: React.CSSProperties
  /** Extra SVG content rendered on top of markings but below points. */
  children?: React.ReactNode
}

export function USARink({
  points,
  showValues,
  logoUrl,
  className,
  style,
  children,
}: USARinkProps) {
  // role="img" marks all descendants presentational, which would strip the
  // interactive point chips (role="button") from the accessibility tree —
  // use "group" whenever any point is clickable.
  const interactive = points.some((p) => p.onClick)
  return (
    <svg
      viewBox={`0 0 ${RINK_W} ${RINK_H}`}
      preserveAspectRatio="xMidYMid meet"
      className={cn("w-full", className)}
      style={style}
      role={interactive ? "group" : "img"}
      aria-label="USA Hockey rink diagram with ice-depth measurement points"
    >
      <RinkMarkings />
      {logoUrl && (
        <image
          href={logoUrl}
          x="155"
          y="335"
          width="70"
          height="70"
          preserveAspectRatio="xMidYMid meet"
          clipPath="url(#rr-logo-clip)"
        />
      )}
      {children}
      {points.map((p) => (
        <PointChip key={p.id} {...p} showValues={showValues} />
      ))}
    </svg>
  )
}
