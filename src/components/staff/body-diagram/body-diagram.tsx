"use client"

import { useId } from "react"

import { cn } from "@/lib/utils"

import {
  BODY_PART_KEYS,
  BODY_PART_LABELS,
  type BodyPartKey,
  type BodySelections,
  type BodySide,
  nextSide,
} from "./types"

export type BodyDiagramProps = {
  selections: BodySelections
  onChange?: (key: BodyPartKey, side: BodySide) => void
  readOnly?: boolean
  className?: string
}

type ViewName = "front" | "back"

const VIEW_W = 240
const VIEW_H = 560

// Cartoon-style figure built from simple primitives (rects/ellipses/circles)
// per body part. Each region is one shape (or a small group of mirrored
// shapes) so the entire region shares one fill on selection.
//
// Coordinate plan (centered on x=120):
//   head        ellipse cx=120 cy=52 rx=32 ry=38      (smiley face overlay on front only)
//   face_jaw    lower half of head ellipse            (front only)
//   neck        rect 110-130 y 86-108
//   shoulders   two circles cx=72/168 cy=132 r=20
//   torso       rounded rect x 85-155 y 116-238
//   arms        upper arm + forearm rects on both sides
//   elbows      two circles cx=58/182 cy=232 r=14
//   wrists      two circles cx=58/182 cy=322 r=11
//   hands       two rounded rects
//   fingers     small rounded shapes at hand tips
//   hips        rounded rect x 84-156 y 244-298
//   upper_legs  two rects
//   knees       two circles
//   lower_legs  two rects
//   ankles      two circles
//   feet        two foot ellipses

type RegionDef = {
  key: BodyPartKey
  front?: React.ReactNode
  back?: React.ReactNode
}

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  r = 0
): React.ReactNode {
  return <rect key={`${x}-${y}-${w}-${h}`} x={x} y={y} width={w} height={h} rx={r} ry={r} />
}

function circle(cx: number, cy: number, r: number): React.ReactNode {
  return <circle key={`${cx}-${cy}-${r}`} cx={cx} cy={cy} r={r} />
}

function ellipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number
): React.ReactNode {
  return <ellipse key={`e-${cx}-${cy}-${rx}-${ry}`} cx={cx} cy={cy} rx={rx} ry={ry} />
}

// Build the per-region shapes. We use the same shapes for front and back so
// the figure stays anatomically aligned; face_jaw only exists on the front.
function buildRegions(): RegionDef[] {
  const headFull = (
    <g>
      <ellipse cx={120} cy={52} rx={32} ry={38} />
    </g>
  )
  // Front "head" excludes the lower jaw (claimed by face_jaw).
  const headTopOnly = (
    <g>
      <path d="M120,14 a32,38 0 0 1 32,38 L88,52 a32,38 0 0 1 32,-38 Z" />
    </g>
  )
  const faceJaw = (
    <g>
      <path d="M88,52 L152,52 a32,38 0 0 1 -64,0 Z" />
    </g>
  )

  return [
    { key: "head", front: headTopOnly, back: headFull },
    { key: "face_jaw", front: faceJaw },
    {
      key: "neck",
      front: <g>{rect(108, 88, 24, 20, 4)}</g>,
      back: <g>{rect(108, 88, 24, 20, 4)}</g>,
    },
    {
      key: "shoulders",
      front: (
        <g>
          {circle(72, 132, 20)}
          {circle(168, 132, 20)}
        </g>
      ),
      back: (
        <g>
          {circle(72, 132, 20)}
          {circle(168, 132, 20)}
        </g>
      ),
    },
    {
      key: "torso",
      front: <g>{rect(85, 116, 70, 122, 14)}</g>,
      back: <g>{rect(85, 116, 70, 122, 14)}</g>,
    },
    {
      key: "arms",
      // Upper arm + forearm (elbow/wrist are separate joints)
      front: (
        <g>
          {rect(54, 138, 36, 86, 12)}
          {rect(54, 240, 36, 76, 12)}
          {rect(150, 138, 36, 86, 12)}
          {rect(150, 240, 36, 76, 12)}
        </g>
      ),
      back: (
        <g>
          {rect(54, 138, 36, 86, 12)}
          {rect(54, 240, 36, 76, 12)}
          {rect(150, 138, 36, 86, 12)}
          {rect(150, 240, 36, 76, 12)}
        </g>
      ),
    },
    {
      key: "elbows",
      front: (
        <g>
          {circle(72, 230, 16)}
          {circle(168, 230, 16)}
        </g>
      ),
      back: (
        <g>
          {circle(72, 230, 16)}
          {circle(168, 230, 16)}
        </g>
      ),
    },
    {
      key: "wrists",
      front: (
        <g>
          {circle(72, 322, 12)}
          {circle(168, 322, 12)}
        </g>
      ),
      back: (
        <g>
          {circle(72, 322, 12)}
          {circle(168, 322, 12)}
        </g>
      ),
    },
    {
      key: "hands",
      front: (
        <g>
          {rect(56, 330, 32, 36, 10)}
          {rect(152, 330, 32, 36, 10)}
        </g>
      ),
      back: (
        <g>
          {rect(56, 330, 32, 36, 10)}
          {rect(152, 330, 32, 36, 10)}
        </g>
      ),
    },
    {
      key: "fingers",
      front: (
        <g>
          {rect(58, 364, 28, 12, 5)}
          {rect(154, 364, 28, 12, 5)}
        </g>
      ),
      back: (
        <g>
          {rect(58, 364, 28, 12, 5)}
          {rect(154, 364, 28, 12, 5)}
        </g>
      ),
    },
    {
      key: "hips",
      front: <g>{rect(82, 244, 76, 56, 14)}</g>,
      back: <g>{rect(82, 244, 76, 56, 14)}</g>,
    },
    {
      key: "upper_legs",
      front: (
        <g>
          {rect(88, 302, 28, 96, 10)}
          {rect(124, 302, 28, 96, 10)}
        </g>
      ),
      back: (
        <g>
          {rect(88, 302, 28, 96, 10)}
          {rect(124, 302, 28, 96, 10)}
        </g>
      ),
    },
    {
      key: "knees",
      front: (
        <g>
          {circle(102, 406, 16)}
          {circle(138, 406, 16)}
        </g>
      ),
      back: (
        <g>
          {circle(102, 406, 16)}
          {circle(138, 406, 16)}
        </g>
      ),
    },
    {
      key: "lower_legs",
      front: (
        <g>
          {rect(90, 416, 24, 78, 10)}
          {rect(126, 416, 24, 78, 10)}
        </g>
      ),
      back: (
        <g>
          {rect(90, 416, 24, 78, 10)}
          {rect(126, 416, 24, 78, 10)}
        </g>
      ),
    },
    {
      key: "ankles",
      front: (
        <g>
          {circle(102, 500, 11)}
          {circle(138, 500, 11)}
        </g>
      ),
      back: (
        <g>
          {circle(102, 500, 11)}
          {circle(138, 500, 11)}
        </g>
      ),
    },
    {
      key: "feet",
      front: (
        <g>
          {ellipse(102, 524, 18, 14)}
          {ellipse(138, 524, 18, 14)}
        </g>
      ),
      back: (
        <g>
          {ellipse(102, 524, 18, 14)}
          {ellipse(138, 524, 18, 14)}
        </g>
      ),
    },
    // Legacy: render over head + neck only when present on historical reports.
    {
      key: "head_neck",
      front: (
        <g>
          <ellipse cx={120} cy={52} rx={32} ry={38} />
          {rect(108, 88, 24, 20, 4)}
        </g>
      ),
      back: (
        <g>
          <ellipse cx={120} cy={52} rx={32} ry={38} />
          {rect(108, 88, 24, 20, 4)}
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

function fillForSide(side: BodySide, view: ViewName): string {
  if (side === "both" || side === view) return SELECTED_FILL
  return BASE_FILL
}

function strokeForSide(side: BodySide, view: ViewName): string {
  if (side === "both" || side === view) return SELECTED_STROKE
  return BASE_STROKE
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
  onChange?: (key: BodyPartKey, side: BodySide) => void
  readOnly?: boolean
  titleId: string
}) {
  const handleClick = (key: BodyPartKey) => {
    if (readOnly || !onChange) return
    onChange(key, nextSide(selections[key], view))
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
          const node = view === "front" ? region.front : region.back
          if (!node) return null
          const side = selections[region.key]
          const label = `${BODY_PART_LABELS[region.key]} (${view})`
          const fill = fillForSide(side, view)
          const stroke = strokeForSide(side, view)
          return (
            <g
              key={region.key}
              aria-label={region.key}
              data-body-part={region.key}
              onClick={() => handleClick(region.key)}
              style={{
                cursor: readOnly ? "default" : "pointer",
                pointerEvents: readOnly ? "none" : "auto",
                fill,
                stroke,
                strokeWidth: 2,
                strokeLinejoin: "round",
                transition: "fill 120ms ease, stroke 120ms ease",
              }}
            >
              <title>{label}</title>
              {node}
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
            <circle cx={110} cy={46} r={2.2} />
            <circle cx={130} cy={46} r={2.2} />
            {/* smile */}
            <path d="M108,58 Q120,68 132,58" fill="none" />
          </g>
        ) : null}
      </svg>
    </figure>
  )
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
  const selectedEntries = BODY_PART_KEYS.filter(
    (key) => selections[key] !== "none"
  )

  const removeRow = (key: BodyPartKey) => {
    if (readOnly || !onChange) return
    onChange(key, "none")
  }

  const clearAll = () => {
    if (readOnly || !onChange) return
    for (const key of BODY_PART_KEYS) {
      if (selections[key] !== "none") onChange(key, "none")
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
          {!readOnly && selectedEntries.length > 0 ? (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
            >
              Clear all
            </button>
          ) : null}
        </div>
        {selectedEntries.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">
            None selected. Tap regions on the diagram or use the buttons below.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {selectedEntries.map((key) => (
              <li
                key={key}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium">{BODY_PART_LABELS[key]}</span>
                  <SideBadge side={selections[key]} />
                </span>
                {!readOnly ? (
                  <button
                    type="button"
                    onClick={() => removeRow(key)}
                    className="rounded-md border border-input bg-background px-2 py-1 text-xs hover:bg-accent"
                    aria-label={`Remove ${BODY_PART_LABELS[key]}`}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
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
