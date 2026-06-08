"use client"

import { useId, useState } from "react"

import { cn } from "@/lib/utils"

import {
  BODY_PART_KEYS,
  BODY_PART_LABELS,
  EMPTY_PAIRED,
  isLegacyBodyPartKey,
  isPairedBodyPartKey,
  nextSide,
  pairedIsEmpty,
  type BodyPartKey,
  type BodySelections,
  type BodySide,
  type Laterality,
  type MidlineBodyPartKey,
  type PairedBodyPartKey,
  type PairedSelection,
  type RegionSelection,
} from "./types"

export type BodyDiagramProps = {
  selections: BodySelections
  onChange?: (key: BodyPartKey, value: RegionSelection) => void
  readOnly?: boolean
  className?: string
}

type ViewName = "front" | "back"

const VIEW_W = 240
const VIEW_H = 580

// Cartoon-style figure built from simple primitives (rects/ellipses/circles)
// per body part. Paired regions (arms, legs, shoulders, …) render as TWO
// independent groups — one per laterality — so the left and right limbs are
// separately selectable. Midline regions (head, neck, face_jaw, torso, hips)
// render as a single group.
//
// Coordinate plan (centered on x=120):
//   head        ellipse cx=120 cy=44 rx=30 ry=34       (smiley face overlay on front only)
//   face_jaw    lower half of head ellipse             (front only)
//   neck        rect 104-136 y 82-110                  (gap above + below to separate visually)
//   shoulders   two circles cx=72/168 cy=140 r=22      (paired, independently clickable)
//   torso       rounded rect x 85-155 y 122-244
//   arms        upper-arm + forearm rects per side     (paired)
//   elbows      two circles per side                   (paired)
//   wrists      two circles per side                   (paired)
//   hands       two rounded rects per side             (paired)
//   fingers     two rounded rects per side             (paired)
//   hips        rounded rect x 82-158 y 250-304
//   upper_legs  one rect per side                      (paired)
//   knees       one circle per side                    (paired)
//   lower_legs  one rect per side                      (paired)
//   ankles      one circle per side                    (paired)
//   feet        one ellipse per side                   (paired)

type MidlineRegion = {
  kind: "midline"
  key: MidlineBodyPartKey
  front?: React.ReactNode
  back?: React.ReactNode
}

type PairedRegion = {
  kind: "paired"
  key: PairedBodyPartKey
  // Each side renders both on the front and back view; if a side has
  // different geometry per view, supply both. Most regions are symmetric
  // and reuse the same shapes for both views.
  left: { front?: React.ReactNode; back?: React.ReactNode }
  right: { front?: React.ReactNode; back?: React.ReactNode }
}

type RegionDef = MidlineRegion | PairedRegion

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  r = 0,
  k?: string
): React.ReactNode {
  return (
    <rect
      key={k ?? `${x}-${y}-${w}-${h}`}
      x={x}
      y={y}
      width={w}
      height={h}
      rx={r}
      ry={r}
    />
  )
}

function circle(cx: number, cy: number, r: number, k?: string): React.ReactNode {
  return <circle key={k ?? `${cx}-${cy}-${r}`} cx={cx} cy={cy} r={r} />
}

function ellipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  k?: string
): React.ReactNode {
  return (
    <ellipse key={k ?? `e-${cx}-${cy}-${rx}-${ry}`} cx={cx} cy={cy} rx={rx} ry={ry} />
  )
}

// X-coordinates per side. Left in the viewer's perspective uses cx=72, which is
// the figure's RIGHT-of-body when looking at the front view — but for the
// purposes of this diagram we label sides from the viewer's perspective on the
// front view (left side of the page = "left" selection). The same physical
// pixel position on the back view corresponds to the figure's right shoulder;
// we accept this convention as it matches what users tap on screen. Read-only
// renderers and PDF labels report laterality as the user selected it on the
// front view.
const LEFT_OUTER = 54
const RIGHT_INNER = 150

function buildRegions(): RegionDef[] {
  // Head shapes. Front excludes the lower jaw (claimed by face_jaw).
  const HEAD_CX = 120
  const HEAD_CY = 44
  const HEAD_RX = 30
  const HEAD_RY = 34
  const HEAD_JAW_LINE = HEAD_CY // y at which we split top vs jaw
  const headFull = (
    <g>
      <ellipse cx={HEAD_CX} cy={HEAD_CY} rx={HEAD_RX} ry={HEAD_RY} />
    </g>
  )
  const headTopOnly = (
    <g>
      <path
        d={`M${HEAD_CX},${HEAD_CY - HEAD_RY} a${HEAD_RX},${HEAD_RY} 0 0 1 ${HEAD_RX},${HEAD_RY} L${HEAD_CX - HEAD_RX},${HEAD_JAW_LINE} a${HEAD_RX},${HEAD_RY} 0 0 1 ${HEAD_RX},-${HEAD_RY} Z`}
      />
    </g>
  )
  const faceJaw = (
    <g>
      <path
        d={`M${HEAD_CX - HEAD_RX},${HEAD_JAW_LINE} L${HEAD_CX + HEAD_RX},${HEAD_JAW_LINE} a${HEAD_RX},${HEAD_RY} 0 0 1 -${HEAD_RX * 2},0 Z`}
      />
    </g>
  )

  const neckShape = <g>{rect(104, 82, 32, 28, 6, "neck")}</g>

  const torsoShape = <g>{rect(85, 122, 70, 122, 14, "torso")}</g>
  const hipsShape = <g>{rect(82, 250, 76, 54, 14, "hips")}</g>

  // Paired regions: shoulder, arm (upper + forearm), elbow, wrist, hand,
  // fingers, upper_leg, knee, lower_leg, ankle, foot. Each laterality renders
  // the geometry for its own side.
  const shoulderLeft = <g>{circle(72, 140, 22, "sh-l")}</g>
  const shoulderRight = <g>{circle(168, 140, 22, "sh-r")}</g>

  // Arms: upper arm and lower arm (forearm) are independent regions per side,
  // so each is selectable on its own (mirrors upper_leg / lower_leg).
  const upperArmLeft = <g>{rect(LEFT_OUTER, 148, 36, 86, 12, "ua-l")}</g>
  const upperArmRight = <g>{rect(RIGHT_INNER, 148, 36, 86, 12, "ua-r")}</g>
  const lowerArmLeft = <g>{rect(LEFT_OUTER, 250, 36, 76, 12, "la-l")}</g>
  const lowerArmRight = <g>{rect(RIGHT_INNER, 250, 36, 76, 12, "la-r")}</g>
  // Legacy whole-arm geometry: only rendered for historical `arms` selections
  // (see the legacy paired-region skip in ViewSvg).
  const legacyArmLeft = (
    <g>
      {rect(LEFT_OUTER, 148, 36, 86, 12, "arm-l-u")}
      {rect(LEFT_OUTER, 250, 36, 76, 12, "arm-l-f")}
    </g>
  )
  const legacyArmRight = (
    <g>
      {rect(RIGHT_INNER, 148, 36, 86, 12, "arm-r-u")}
      {rect(RIGHT_INNER, 250, 36, 76, 12, "arm-r-f")}
    </g>
  )

  const elbowLeft = <g>{circle(72, 240, 16, "el-l")}</g>
  const elbowRight = <g>{circle(168, 240, 16, "el-r")}</g>

  const wristLeft = <g>{circle(72, 332, 12, "wr-l")}</g>
  const wristRight = <g>{circle(168, 332, 12, "wr-r")}</g>

  const handLeft = <g>{rect(56, 340, 32, 36, 10, "ha-l")}</g>
  const handRight = <g>{rect(152, 340, 32, 36, 10, "ha-r")}</g>

  const fingersLeft = <g>{rect(58, 374, 28, 12, 5, "fi-l")}</g>
  const fingersRight = <g>{rect(154, 374, 28, 12, 5, "fi-r")}</g>

  const upperLegLeft = <g>{rect(88, 308, 28, 96, 10, "ul-l")}</g>
  const upperLegRight = <g>{rect(124, 308, 28, 96, 10, "ul-r")}</g>

  const kneeLeft = <g>{circle(102, 412, 16, "kn-l")}</g>
  const kneeRight = <g>{circle(138, 412, 16, "kn-r")}</g>

  const lowerLegLeft = <g>{rect(90, 422, 24, 78, 10, "ll-l")}</g>
  const lowerLegRight = <g>{rect(126, 422, 24, 78, 10, "ll-r")}</g>

  const ankleLeft = <g>{circle(102, 506, 11, "an-l")}</g>
  const ankleRight = <g>{circle(138, 506, 11, "an-r")}</g>

  const footLeft = <g>{ellipse(102, 530, 18, 14, "ft-l")}</g>
  const footRight = <g>{ellipse(138, 530, 18, 14, "ft-r")}</g>

  return [
    { kind: "midline", key: "head", front: headTopOnly, back: headFull },
    { kind: "midline", key: "face_jaw", front: faceJaw },
    { kind: "midline", key: "neck", front: neckShape, back: neckShape },
    {
      kind: "paired",
      key: "shoulders",
      left: { front: shoulderLeft, back: shoulderLeft },
      right: { front: shoulderRight, back: shoulderRight },
    },
    { kind: "midline", key: "torso", front: torsoShape, back: torsoShape },
    {
      kind: "paired",
      key: "upper_arms",
      left: { front: upperArmLeft, back: upperArmLeft },
      right: { front: upperArmRight, back: upperArmRight },
    },
    {
      kind: "paired",
      key: "lower_arms",
      left: { front: lowerArmLeft, back: lowerArmLeft },
      right: { front: lowerArmRight, back: lowerArmRight },
    },
    {
      kind: "paired",
      key: "elbows",
      left: { front: elbowLeft, back: elbowLeft },
      right: { front: elbowRight, back: elbowRight },
    },
    {
      kind: "paired",
      key: "wrists",
      left: { front: wristLeft, back: wristLeft },
      right: { front: wristRight, back: wristRight },
    },
    {
      kind: "paired",
      key: "hands",
      left: { front: handLeft, back: handLeft },
      right: { front: handRight, back: handRight },
    },
    {
      kind: "paired",
      key: "fingers",
      left: { front: fingersLeft, back: fingersLeft },
      right: { front: fingersRight, back: fingersRight },
    },
    { kind: "midline", key: "hips", front: hipsShape, back: hipsShape },
    {
      kind: "paired",
      key: "upper_legs",
      left: { front: upperLegLeft, back: upperLegLeft },
      right: { front: upperLegRight, back: upperLegRight },
    },
    {
      kind: "paired",
      key: "knees",
      left: { front: kneeLeft, back: kneeLeft },
      right: { front: kneeRight, back: kneeRight },
    },
    {
      kind: "paired",
      key: "lower_legs",
      left: { front: lowerLegLeft, back: lowerLegLeft },
      right: { front: lowerLegRight, back: lowerLegRight },
    },
    {
      kind: "paired",
      key: "ankles",
      left: { front: ankleLeft, back: ankleLeft },
      right: { front: ankleRight, back: ankleRight },
    },
    {
      kind: "paired",
      key: "feet",
      left: { front: footLeft, back: footLeft },
      right: { front: footRight, back: footRight },
    },
    // Legacy: whole-arm region, rendered per laterality only when a historical
    // report carries an `arms` selection (the legacy skip in ViewSvg hides it
    // for new submissions, which use upper_arms / lower_arms instead).
    {
      kind: "paired",
      key: "arms",
      left: { front: legacyArmLeft, back: legacyArmLeft },
      right: { front: legacyArmRight, back: legacyArmRight },
    },
    // Legacy: render head + neck combined only when present on historical
    // reports. Treated as midline.
    {
      kind: "midline",
      key: "head_neck",
      front: (
        <g>
          <ellipse cx={HEAD_CX} cy={HEAD_CY} rx={HEAD_RX} ry={HEAD_RY} />
          {rect(104, 82, 32, 28, 6, "hn-neck")}
        </g>
      ),
      back: (
        <g>
          <ellipse cx={HEAD_CX} cy={HEAD_CY} rx={HEAD_RX} ry={HEAD_RY} />
          {rect(104, 82, 32, 28, 6, "hn-neck")}
        </g>
      ),
    },
  ]
}

const REGIONS = buildRegions()

const BASE_FILL = "#dbeafe" // blue-100
const BASE_STROKE = "#3b82f6" // blue-500
const SELECTED_FILL = "#ef4444" // red-500
const SELECTED_STROKE = "#b91c1c" // red-700
const HOVER_FILL = "#bfdbfe" // blue-200

function paintForSide(
  side: BodySide,
  view: ViewName
): { fill: string; stroke: string } {
  if (side === "both" || side === view) {
    return { fill: SELECTED_FILL, stroke: SELECTED_STROKE }
  }
  return { fill: BASE_FILL, stroke: BASE_STROKE }
}

function ViewSvg({
  view,
  selections,
  onChange,
  readOnly,
  titleId,
}: {
  view: ViewName
  selections: BodySelections
  onChange?: (key: BodyPartKey, value: RegionSelection) => void
  readOnly?: boolean
  titleId: string
}) {
  const [hovered, setHovered] = useState<string | null>(null)

  const enter = (id: string) => {
    if (readOnly) return
    setHovered(id)
  }
  const leave = (id: string) => {
    if (readOnly) return
    setHovered((cur) => (cur === id ? null : cur))
  }

  const handleMidlineClick = (key: MidlineBodyPartKey) => {
    if (readOnly || !onChange) return
    const current = selections[key]
    onChange(key, nextSide(current, view))
  }

  const handlePairedClick = (
    key: PairedBodyPartKey,
    laterality: Laterality
  ) => {
    if (readOnly || !onChange) return
    const current = selections[key]
    const updated: PairedSelection = {
      ...current,
      [laterality]: nextSide(current[laterality], view),
    }
    onChange(key, updated)
  }

  return (
    <figure className="flex flex-col items-center gap-2">
      <figcaption className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {view === "front" ? "Front View" : "Back View"}
      </figcaption>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-labelledby={titleId}
        className="h-auto w-full max-w-[240px] touch-manipulation"
      >
        <title id={titleId}>
          {view === "front"
            ? "Front view of body. Tap a region to mark it as injured."
            : "Back view of body. Tap a region to mark it as injured."}
        </title>

        {REGIONS.map((region) => {
          if (region.kind === "midline") {
            const node = view === "front" ? region.front : region.back
            if (!node) return null
            const side = selections[region.key]
            // Legacy `head_neck` overlays both the head ellipse and the neck
            // rect at the same coordinates as the real head/neck regions.
            // While it's drawn it paints (and intercepts clicks) on top of
            // both, so new submissions can't click head OR neck without
            // toggling head_neck instead. Only render it when a historical
            // report actually carries a head_neck selection.
            if (region.key === "head_neck" && side === "none") return null
            const isHovered = hovered === region.key
            const paint = paintForSide(side, view)
            const fill =
              isHovered && paint.fill === BASE_FILL ? HOVER_FILL : paint.fill
            return (
              <g
                key={region.key}
                aria-label={BODY_PART_LABELS[region.key]}
                data-body-part={region.key}
                onClick={() => handleMidlineClick(region.key)}
                onMouseEnter={() => enter(region.key)}
                onMouseLeave={() => leave(region.key)}
                style={{
                  cursor: readOnly ? "default" : "pointer",
                  pointerEvents: readOnly ? "none" : "auto",
                  fill,
                  stroke: paint.stroke,
                  strokeWidth: 2,
                  strokeLinejoin: "round",
                  transition: "fill 120ms ease, stroke 120ms ease",
                }}
              >
                <title>{`${BODY_PART_LABELS[region.key]} (${view})`}</title>
                {node}
              </g>
            )
          }

          // Paired: render left and right as independent <g>s.
          const paired = selections[region.key]
          return (
            <g key={region.key} data-body-part={region.key}>
              {(["left", "right"] as const).map((lat) => {
                const node =
                  view === "front" ? region[lat].front : region[lat].back
                if (!node) return null
                const side = paired[lat]
                // Legacy paired regions (e.g. `arms`) overlay the new split
                // regions; only paint/intercept where a historical report
                // actually carries a selection so new submissions stay on the
                // upper_arms / lower_arms regions underneath.
                if (isLegacyBodyPartKey(region.key) && side === "none") {
                  return null
                }
                const id = `${region.key}-${lat}`
                const isHovered = hovered === id
                const paint = paintForSide(side, view)
                const fill =
                  isHovered && paint.fill === BASE_FILL ? HOVER_FILL : paint.fill
                const labelSide = lat === "left" ? "Left" : "Right"
                return (
                  <g
                    key={lat}
                    aria-label={`${labelSide} ${BODY_PART_LABELS[region.key]}`}
                    data-laterality={lat}
                    onClick={() => handlePairedClick(region.key, lat)}
                    onMouseEnter={() => enter(id)}
                    onMouseLeave={() => leave(id)}
                    style={{
                      cursor: readOnly ? "default" : "pointer",
                      pointerEvents: readOnly ? "none" : "auto",
                      fill,
                      stroke: paint.stroke,
                      strokeWidth: 2,
                      strokeLinejoin: "round",
                      transition: "fill 120ms ease, stroke 120ms ease",
                    }}
                  >
                    <title>{`${labelSide} ${BODY_PART_LABELS[region.key]} (${view})`}</title>
                    {node}
                  </g>
                )
              })}
            </g>
          )
        })}

        {/* Smiley face overlay - front view only, purely decorative */}
        {view === "front" ? (
          <g
            pointerEvents="none"
            stroke="#1d4ed8"
            strokeWidth={2}
            strokeLinecap="round"
            fill="#1d4ed8"
          >
            {/* eyes */}
            <circle cx={110} cy={40} r={2.2} />
            <circle cx={130} cy={40} r={2.2} />
            {/* smile */}
            <path d="M108,52 Q120,62 132,52" fill="none" />
          </g>
        ) : null}
      </svg>
    </figure>
  )
}

// ---------------------------------------------------------------------------
// Selected-rows summary
// ---------------------------------------------------------------------------

type SummaryRow =
  | {
      kind: "midline"
      key: MidlineBodyPartKey
      side: BodySide
    }
  | {
      kind: "paired"
      key: PairedBodyPartKey
      laterality: Laterality
      side: BodySide
    }

function buildSummary(selections: BodySelections): SummaryRow[] {
  const out: SummaryRow[] = []
  for (const key of BODY_PART_KEYS) {
    if (isPairedBodyPartKey(key)) {
      const p = selections[key]
      if (p.left !== "none")
        out.push({ kind: "paired", key, laterality: "left", side: p.left })
      if (p.right !== "none")
        out.push({ kind: "paired", key, laterality: "right", side: p.right })
    } else {
      const s = selections[key]
      if (s !== "none") out.push({ kind: "midline", key, side: s })
    }
  }
  return out
}

export function BodyDiagram({
  selections,
  onChange,
  readOnly = false,
  className,
}: BodyDiagramProps) {
  const baseId = useId()

  // Hide the legacy head_neck row from the live selectors; it's still
  // rendered in the SVG if present (e.g. on historical reports in admin view).
  const visibleKeys = BODY_PART_KEYS.filter((k) => k !== "head_neck")
  const summary = buildSummary(selections)

  const removeSummaryRow = (row: SummaryRow) => {
    if (readOnly || !onChange) return
    if (row.kind === "midline") {
      onChange(row.key, "none")
    } else {
      const cur = selections[row.key]
      onChange(row.key, { ...cur, [row.laterality]: "none" })
    }
  }

  const clearAll = () => {
    if (readOnly || !onChange) return
    for (const key of BODY_PART_KEYS) {
      if (isPairedBodyPartKey(key)) {
        if (!pairedIsEmpty(selections[key])) onChange(key, { ...EMPTY_PAIRED })
      } else if (selections[key] !== "none") {
        onChange(key, "none")
      }
    }
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ViewSvg
          view="front"
          selections={selections}
          onChange={onChange}
          readOnly={readOnly}
          titleId={`${baseId}-front`}
        />
        <ViewSvg
          view="back"
          selections={selections}
          onChange={onChange}
          readOnly={readOnly}
          titleId={`${baseId}-back`}
        />
      </div>

      <div
        className="rounded-lg border bg-card"
        role="region"
        aria-label="Selected body parts"
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Selected body parts
          </span>
          {!readOnly && summary.length > 0 ? (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
            >
              Clear all
            </button>
          ) : null}
        </div>
        {summary.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">
            None selected. Tap regions on the diagram or use the buttons below.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {summary.map((row, idx) => {
              const label =
                row.kind === "paired"
                  ? `${row.laterality === "left" ? "Left" : "Right"} ${BODY_PART_LABELS[row.key]}`
                  : BODY_PART_LABELS[row.key]
              const removeLabel = `Remove ${label}`
              return (
                <li
                  key={`${row.key}-${row.kind === "paired" ? row.laterality : "midline"}-${idx}`}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{label}</span>
                    <SideBadge side={row.side} />
                  </span>
                  {!readOnly ? (
                    <button
                      type="button"
                      onClick={() => removeSummaryRow(row)}
                      className="rounded-md border border-input bg-background px-2 py-1 text-xs hover:bg-accent"
                      aria-label={removeLabel}
                    >
                      Remove
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {!readOnly ? (
        <details className="rounded-lg border bg-card">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
            Add by list (accessible alternative)
          </summary>
          <div className="grid grid-cols-1 gap-2 px-3 pb-3 sm:grid-cols-2">
            {visibleKeys.map((key) => {
              if (isPairedBodyPartKey(key)) {
                const paired = selections[key]
                return (
                  <div
                    key={key}
                    className="rounded-md border bg-background"
                  >
                    <div className="border-b px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {BODY_PART_LABELS[key]}
                    </div>
                    {(["left", "right"] as const).map((lat) => {
                      const side = paired[lat]
                      const rowLabel = lat === "left" ? "Left" : "Right"
                      return (
                        <div
                          key={lat}
                          className="flex items-center justify-between gap-2 border-t border-border px-2 py-2 first:border-t-0"
                        >
                          <span className="text-sm font-medium">{rowLabel}</span>
                          <div className="flex items-center gap-1">
                            {(["front", "back", "both", "none"] as const).map(
                              (s) => (
                                <button
                                  key={s}
                                  type="button"
                                  onClick={() =>
                                    onChange?.(key, { ...paired, [lat]: s })
                                  }
                                  aria-pressed={side === s}
                                  className={cn(
                                    "min-h-[36px] rounded-md border px-2 py-1 text-xs",
                                    side === s
                                      ? "border-red-600 bg-red-600/10 text-red-700"
                                      : "border-input bg-background hover:bg-accent"
                                  )}
                                >
                                  {s}
                                </button>
                              )
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              }
              const side = selections[key]
              return (
                <div
                  key={key}
                  className="flex items-center justify-between gap-2 rounded-md border px-2 py-2"
                >
                  <span className="text-sm font-medium">
                    {BODY_PART_LABELS[key]}
                  </span>
                  <div className="flex items-center gap-1">
                    {(["front", "back", "both", "none"] as const).map((s) => {
                      // face_jaw only meaningful on the front; disable back/both for it.
                      const disabled =
                        key === "face_jaw" && (s === "back" || s === "both")
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => !disabled && onChange?.(key, s)}
                          aria-pressed={side === s}
                          disabled={disabled}
                          className={cn(
                            "min-h-[36px] rounded-md border px-2 py-1 text-xs",
                            side === s
                              ? "border-red-600 bg-red-600/10 text-red-700"
                              : "border-input bg-background hover:bg-accent",
                            disabled && "cursor-not-allowed opacity-40 hover:bg-background"
                          )}
                        >
                          {s}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </details>
      ) : null}
    </div>
  )
}

function SideBadge({ side }: { side: BodySide }) {
  const labels: Record<BodySide, string> = {
    front: "Front",
    back: "Back",
    both: "Both",
    none: "None",
  }
  const classes: Record<BodySide, string> = {
    front: "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200",
    back: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
    both: "bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200",
    none: "bg-muted text-muted-foreground",
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        classes[side]
      )}
    >
      {labels[side]}
    </span>
  )
}
