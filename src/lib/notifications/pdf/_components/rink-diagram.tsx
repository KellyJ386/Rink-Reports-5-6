import "server-only"

import {
  Circle,
  G,
  Image,
  Line,
  Path,
  Rect,
  Svg,
  Text as SvgText,
  View,
} from "@react-pdf/renderer"
import React from "react"

import {
  RINK_H,
  RINK_W,
  rinkCoords,
} from "@/components/ice-depth/rink-geometry"

// USA Hockey rink dimensions — must mirror src/components/ice-depth/usa-rink.tsx
const S = 3
const RINK_LEFT = 62.5
const RINK_RIGHT = 317.5
const RINK_TOP = 70
const RINK_BOTTOM = 670
const CENTER_X = 190
const CENTER_Y = 370

const GOAL_TOP = RINK_TOP + 11 * S
const GOAL_BOT = RINK_BOTTOM - 11 * S
const BLUE_TOP = GOAL_TOP + 64 * S
const BLUE_BOT = GOAL_BOT - 64 * S

const POST_L = CENTER_X - 3 * S
const POST_R = CENTER_X + 3 * S
const NET_DEPTH = Math.round(3.33 * S)
const CREASE_R = 6 * S
const CIRCLE_R = 15 * S

const END_FO_TOP = GOAL_TOP + 20 * S
const END_FO_BOT = GOAL_BOT - 20 * S
const FO_X_L = CENTER_X - 22 * S
const FO_X_R = CENTER_X + 22 * S

const NEUTRAL_TOP = BLUE_TOP + 5 * S
const NEUTRAL_BOT = BLUE_BOT - 5 * S

const TRAP_GOAL_L = POST_L - 6 * S
const TRAP_GOAL_R = POST_R + 6 * S
const TRAP_BOARD_L = CENTER_X - 14 * S
const TRAP_BOARD_R = CENTER_X + 14 * S

// Severity colors per user spec: ok=green, low=red, high=yellow.
const SEVERITY_FILL: Record<"ok" | "low" | "high", string> = {
  ok: "#16a34a",
  low: "#dc2626",
  high: "#eab308",
}

const CHIP_R = 16

export type DiagramPoint = {
  cx: number
  cy: number
  point_number: number
  // Recorded measurement, or null when the operator skipped this point.
  measurement: {
    depth_value: number
    severity: "ok" | "low" | "high"
  } | null
}

function EndZoneFaceoff({ fx, fy }: { fx: number; fy: number }) {
  return (
    <G>
      <Circle cx={fx} cy={fy} r={CIRCLE_R} fill="none" stroke="#cc0000" strokeWidth={1.5} />
      <Circle cx={fx} cy={fy} r={4} fill="#cc0000" />
    </G>
  )
}

function RinkMarkings() {
  return (
    <G>
      {/* Ice surface */}
      <Rect
        x={62.5}
        y={70}
        width={255}
        height={600}
        rx={84}
        ry={84}
        fill="#e8f4f8"
        stroke="#333333"
        strokeWidth={2}
      />

      {/* Goal lines */}
      <Line x1={80} y1={GOAL_TOP} x2={300} y2={GOAL_TOP} stroke="#cc0000" strokeWidth={2} />
      <Line x1={80} y1={GOAL_BOT} x2={300} y2={GOAL_BOT} stroke="#cc0000" strokeWidth={2} />

      {/* Blue lines */}
      <Line x1={RINK_LEFT} y1={BLUE_TOP} x2={RINK_RIGHT} y2={BLUE_TOP} stroke="#003087" strokeWidth={4} />
      <Line x1={RINK_LEFT} y1={BLUE_BOT} x2={RINK_RIGHT} y2={BLUE_BOT} stroke="#003087" strokeWidth={4} />

      {/* Center red line */}
      <Line x1={RINK_LEFT} y1={CENTER_Y} x2={RINK_RIGHT} y2={CENTER_Y} stroke="#c8102e" strokeWidth={4} />

      {/* Goals (nets) */}
      <Rect
        x={POST_L}
        y={GOAL_TOP - NET_DEPTH}
        width={POST_R - POST_L}
        height={NET_DEPTH}
        fill="#eeeeee"
        stroke="#cc0000"
        strokeWidth={1.5}
      />
      <Rect
        x={POST_L}
        y={GOAL_BOT}
        width={POST_R - POST_L}
        height={NET_DEPTH}
        fill="#eeeeee"
        stroke="#cc0000"
        strokeWidth={1.5}
      />

      {/* Goal post dots */}
      <Circle cx={POST_L} cy={GOAL_TOP} r={2.5} fill="#cc0000" />
      <Circle cx={POST_R} cy={GOAL_TOP} r={2.5} fill="#cc0000" />
      <Circle cx={POST_L} cy={GOAL_BOT} r={2.5} fill="#cc0000" />
      <Circle cx={POST_R} cy={GOAL_BOT} r={2.5} fill="#cc0000" />

      {/* Goal creases (D-shape) */}
      <Path
        d={`M ${CENTER_X - CREASE_R} ${GOAL_TOP} A ${CREASE_R} ${CREASE_R} 0 0 1 ${CENTER_X + CREASE_R} ${GOAL_TOP}`}
        fill="#a8d4f0"
        stroke="#cc0000"
        strokeWidth={1.5}
      />
      <Path
        d={`M ${CENTER_X - CREASE_R} ${GOAL_BOT} A ${CREASE_R} ${CREASE_R} 0 0 0 ${CENTER_X + CREASE_R} ${GOAL_BOT}`}
        fill="#a8d4f0"
        stroke="#cc0000"
        strokeWidth={1.5}
      />

      {/* Trapezoid lines */}
      <Line x1={TRAP_GOAL_L} y1={GOAL_TOP} x2={TRAP_BOARD_L} y2={RINK_TOP} stroke="#cc0000" strokeWidth={1.5} />
      <Line x1={TRAP_GOAL_R} y1={GOAL_TOP} x2={TRAP_BOARD_R} y2={RINK_TOP} stroke="#cc0000" strokeWidth={1.5} />
      <Line x1={TRAP_GOAL_L} y1={GOAL_BOT} x2={TRAP_BOARD_L} y2={RINK_BOTTOM} stroke="#cc0000" strokeWidth={1.5} />
      <Line x1={TRAP_GOAL_R} y1={GOAL_BOT} x2={TRAP_BOARD_R} y2={RINK_BOTTOM} stroke="#cc0000" strokeWidth={1.5} />

      {/* Center face-off circle */}
      <Circle cx={CENTER_X} cy={CENTER_Y} r={CIRCLE_R} fill="none" stroke="#003087" strokeWidth={2} />
      <Circle cx={CENTER_X} cy={CENTER_Y} r={4} fill="#003087" />

      {/* Neutral-zone face-off spots */}
      {(
        [
          [FO_X_L, NEUTRAL_TOP],
          [FO_X_R, NEUTRAL_TOP],
          [FO_X_L, NEUTRAL_BOT],
          [FO_X_R, NEUTRAL_BOT],
        ] as [number, number][]
      ).map(([fx, fy], i) => (
        <G key={i}>
          <Circle cx={fx} cy={fy} r={4} fill="#c8102e" />
          <Circle cx={fx} cy={fy} r={7} fill="none" stroke="#c8102e" strokeWidth={1.5} />
        </G>
      ))}

      {/* End-zone face-off circles */}
      <EndZoneFaceoff fx={FO_X_L} fy={END_FO_TOP} />
      <EndZoneFaceoff fx={FO_X_R} fy={END_FO_TOP} />
      <EndZoneFaceoff fx={FO_X_L} fy={END_FO_BOT} />
      <EndZoneFaceoff fx={FO_X_R} fy={END_FO_BOT} />
    </G>
  )
}

function formatDepth(v: number, unit: "inches" | "mm"): string {
  if (!Number.isFinite(v)) return "—"
  if (unit === "inches") {
    return v.toFixed(2)
  }
  return v.toFixed(0)
}

export function PdfRinkDiagram({
  points,
  unit,
  logoUrl,
  width,
}: {
  points: DiagramPoint[]
  unit: "inches" | "mm"
  logoUrl: string | null
  width: number
}) {
  const height = (width * RINK_H) / RINK_W
  const scale = width / RINK_W
  // Logo sits inside the center face-off circle (diameter 70 in SVG units).
  const logoSize = 60 * scale
  const logoLeft = CENTER_X * scale - logoSize / 2
  const logoTop = CENTER_Y * scale - logoSize / 2

  return (
    <View style={{ width, height, position: "relative" }}>
      <Svg
        width={width}
        height={height}
        viewBox={`0 0 ${RINK_W} ${RINK_H}`}
      >
        <RinkMarkings />

        {points.map((p, i) => {
          const m = p.measurement
          const fill = m ? SEVERITY_FILL[m.severity] : "#e2e8f0"
          const stroke = m ? "#0f172a" : "#94a3b8"
          const textFill = m ? "#ffffff" : "#64748b"
          const label = m ? formatDepth(m.depth_value, unit) : String(p.point_number)
          return (
            <G key={i}>
              <Circle
                cx={p.cx}
                cy={p.cy}
                r={CHIP_R}
                fill={fill}
                stroke={stroke}
                strokeWidth={1}
                strokeDasharray={m ? undefined : "2 2"}
              />
              <SvgText
                x={p.cx}
                y={p.cy + 4}
                fill={textFill}
                textAnchor="middle"
                style={{ fontSize: 10, fontWeight: 700 }}
              >
                {label}
              </SvgText>
            </G>
          )
        })}
      </Svg>
      {logoUrl ? (
        // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image, not HTML img
        <Image
          src={logoUrl}
          style={{
            position: "absolute",
            left: logoLeft,
            top: logoTop,
            width: logoSize,
            height: logoSize,
          }}
        />
      ) : null}
    </View>
  )
}

export { rinkCoords, RINK_W, RINK_H }
