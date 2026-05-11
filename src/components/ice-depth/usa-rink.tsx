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

export const RINK_W = 380
export const RINK_H = 740

/** Map stored 0..1 fractions to viewBox pixel coordinates. */
export function rinkCoords(xPosition: number, yPosition: number) {
  return { cx: xPosition * RINK_W, cy: yPosition * RINK_H }
}

// ---------------------------------------------------------------------------
// Point chip descriptor
// ---------------------------------------------------------------------------

export type PointChipState = "pending" | "current" | "done" | "inactive"

export interface RinkPointSpec {
  id: string
  pointNumber: number
  cx: number
  cy: number
  state: PointChipState
  /** Hex color used when state === 'done'. */
  doneColor?: string
  /** Optional depth label shown inside done chips when showValues=true. */
  depthValue?: number | null
  onClick?: () => void
}

// ---------------------------------------------------------------------------
// USA Hockey rink SVG markings (identical to the design prototype)
// ---------------------------------------------------------------------------

function RinkMarkings() {
  return (
    <>
      <defs>
        <pattern
          id="rr-net"
          x="0"
          y="0"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 0 0 L 6 6 M 6 0 L 0 6"
            stroke="#999"
            strokeWidth="0.5"
            fill="none"
          />
        </pattern>
        <clipPath id="rr-logo-clip">
          <circle cx="190" cy="370" r="43" />
        </clipPath>
      </defs>

      {/* Ice surface */}
      <rect
        x="62.5"
        y="70"
        width="255"
        height="600"
        rx="84"
        ry="84"
        fill="#e8f4f8"
        stroke="#333"
        strokeWidth="2"
      />

      {/* Center red dashed line */}
      <line
        x1="62.5"
        y1="370"
        x2="317.5"
        y2="370"
        stroke="#cc0000"
        strokeWidth="4"
        strokeDasharray="8 8"
      />

      {/* Blue lines */}
      <line
        x1="62.5"
        y1="262"
        x2="317.5"
        y2="262"
        stroke="#0044aa"
        strokeWidth="4"
      />
      <line
        x1="62.5"
        y1="478"
        x2="317.5"
        y2="478"
        stroke="#0044aa"
        strokeWidth="4"
      />

      {/* Goal lines */}
      <line x1="80" y1="103" x2="300" y2="103" stroke="#cc0000" strokeWidth="2" />
      <line x1="80" y1="637" x2="300" y2="637" stroke="#cc0000" strokeWidth="2" />

      {/* Goals (net pattern) */}
      <rect
        x="181"
        y="93"
        width="18"
        height="10"
        fill="url(#rr-net)"
        stroke="#cc0000"
        strokeWidth="2"
      />
      <rect
        x="181"
        y="637"
        width="18"
        height="10"
        fill="url(#rr-net)"
        stroke="#cc0000"
        strokeWidth="2"
      />

      {/* Goal creases */}
      <path
        d="M 172 103 A 18 18 0 0 1 208 103"
        fill="#add8e6"
        stroke="#cc0000"
        strokeWidth="2"
      />
      <path
        d="M 172 637 A 18 18 0 0 0 208 637"
        fill="#add8e6"
        stroke="#cc0000"
        strokeWidth="2"
      />

      {/* Trapezoid lines */}
      <line x1="163" y1="103" x2="148" y2="70" stroke="#cc0000" strokeWidth="2" />
      <line x1="217" y1="103" x2="232" y2="70" stroke="#cc0000" strokeWidth="2" />
      <line x1="163" y1="637" x2="148" y2="670" stroke="#cc0000" strokeWidth="2" />
      <line x1="217" y1="637" x2="232" y2="670" stroke="#cc0000" strokeWidth="2" />

      {/* Center face-off circle */}
      <circle cx="190" cy="370" r="4" fill="#0044aa" />
      <circle
        cx="190"
        cy="370"
        r="45"
        fill="none"
        stroke="#0044aa"
        strokeWidth="2"
      />

      {/* Neutral-zone face-off dots */}
      <circle cx="124" cy="277" r="4" fill="#cc0000" />
      <circle cx="256" cy="277" r="4" fill="#cc0000" />
      <circle cx="124" cy="463" r="4" fill="#cc0000" />
      <circle cx="256" cy="463" r="4" fill="#cc0000" />

      {/* Zone face-off circles (4) with hash marks */}
      {(
        [
          [124, 163],
          [256, 163],
          [124, 577],
          [256, 577],
        ] as [number, number][]
      ).map(([fx, fy], i) => (
        <g key={i}>
          <circle cx={fx} cy={fy} r="4" fill="#cc0000" />
          <circle
            cx={fx}
            cy={fy}
            r="45"
            fill="none"
            stroke="#cc0000"
            strokeWidth="2"
          />
          {/* Hash marks */}
          <path
            d={`M ${fx - 9} ${fy - 9} L ${fx - 9} ${fy - 21} M ${fx - 9} ${fy - 9} L ${fx - 21} ${fy - 9}`}
            fill="none"
            stroke="#cc0000"
            strokeWidth="1.5"
          />
          <path
            d={`M ${fx + 9} ${fy - 9} L ${fx + 9} ${fy - 21} M ${fx + 9} ${fy - 9} L ${fx + 21} ${fy - 9}`}
            fill="none"
            stroke="#cc0000"
            strokeWidth="1.5"
          />
          <path
            d={`M ${fx - 9} ${fy + 9} L ${fx - 9} ${fy + 21} M ${fx - 9} ${fy + 9} L ${fx - 21} ${fy + 9}`}
            fill="none"
            stroke="#cc0000"
            strokeWidth="1.5"
          />
          <path
            d={`M ${fx + 9} ${fy + 9} L ${fx + 9} ${fy + 21} M ${fx + 9} ${fy + 9} L ${fx + 21} ${fy + 9}`}
            fill="none"
            stroke="#cc0000"
            strokeWidth="1.5"
          />
          <line
            x1={fx - 45}
            y1={fy - 9}
            x2={fx - 45}
            y2={fy + 9}
            stroke="#cc0000"
            strokeWidth="1.5"
          />
          <line
            x1={fx + 45}
            y1={fy - 9}
            x2={fx + 45}
            y2={fy + 9}
            stroke="#cc0000"
            strokeWidth="1.5"
          />
        </g>
      ))}
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
  depthValue,
  onClick,
  showValues,
}: RinkPointSpec & { showValues?: boolean }) {
  const isCurrent = state === "current"
  const isDone = state === "done"
  const isInactive = state === "inactive"

  const fill = isDone ? (doneColor ?? "#16a34a") : isCurrent ? "#002244" : "#ffffff"
  const stroke = isCurrent ? "#69BE28" : isDone ? (doneColor ?? "#16a34a") : "#333333"
  const textFill = isDone || isCurrent ? "#ffffff" : "#111111"
  const opacity = isInactive ? 0.4 : 1

  return (
    <g
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : "default" }}
      opacity={opacity}
      role={onClick ? "button" : undefined}
      aria-label={onClick ? `Select point ${pointNumber}` : undefined}
    >
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

      {/* Point number */}
      <text
        x={cx}
        y={showValues && isDone && depthValue != null ? cy - 3 : cy + 4}
        textAnchor="middle"
        fontSize={showValues && isDone ? 8 : 11}
        fontWeight={700}
        fill={textFill}
        style={{ userSelect: "none", fontFamily: "system-ui, sans-serif" }}
      >
        {pointNumber}
      </text>

      {/* Depth value label for sample/history mode */}
      {showValues && isDone && depthValue != null && (
        <text
          x={cx}
          y={cy + 7}
          textAnchor="middle"
          fontSize={7}
          fontWeight={600}
          fill={textFill}
          style={{ userSelect: "none", fontFamily: "monospace" }}
        >
          {depthValue.toFixed(1)}
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
  return (
    <svg
      viewBox={`0 0 ${RINK_W} ${RINK_H}`}
      preserveAspectRatio="xMidYMid meet"
      className={cn("w-full", className)}
      style={style}
      aria-label="Hockey rink diagram"
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
