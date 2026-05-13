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

type RegionDef = {
  key: BodyPartKey
  /** Optional: omit a side to hide this region in that view (e.g. face_jaw on back). */
  front?: string
  back?: string
}

const VIEW_W = 240
const VIEW_H = 540

// Outer silhouette per view. Drawn once as a soft backdrop so the regions
// visually "live inside" a body shape. The path is the same shape for both
// views so the figure stays aligned.
const SILHOUETTE_PATH =
  "M120,10 " +
  // head + jaw left side
  "C92,10 84,30 84,52 " +
  "C84,72 92,88 104,92 " +
  "L100,108 " +
  // shoulder up to deltoid left
  "C82,110 64,118 56,128 " +
  "L52,168 " +
  // upper arm left outer
  "L50,236 " +
  // elbow
  "L52,266 " +
  // forearm left outer
  "L54,338 " +
  // wrist/hand left outer
  "L50,378 " +
  "L46,418 " +
  // fingertips
  "L60,422 L60,410 " +
  // hand inside
  "L72,408 " +
  // forearm inside
  "L78,338 " +
  // elbow inside
  "L82,266 " +
  // upper arm inside / armpit
  "L88,180 " +
  // torso side
  "L98,220 " +
  // waist left
  "L94,258 " +
  // hip outer
  "L88,300 " +
  // outer thigh
  "L94,400 " +
  // knee outer
  "L100,440 " +
  // calf outer
  "L96,500 " +
  // ankle outer
  "L94,520 " +
  // heel
  "L92,536 " +
  "L132,536 " +
  // right foot (mirrored)
  "L128,520 " +
  "L126,500 " +
  "L122,440 " +
  "L128,400 " +
  "L122,300 " +
  "L116,258 " +
  "L116,220 " +
  // crotch + right side mirrored back up
  "L120,258 L124,220 " +
  "L122,220 " +
  "L132,180 " +
  "L138,180 " +
  "L142,180 " +
  "L142,180 " +
  "L142,180 " +
  "L142,180 Z"

// Right-side mirrored path for the silhouette (we draw the full silhouette
// as two halves to keep the path readable). The component renders both halves.
const SILHOUETTE_RIGHT_PATH =
  "M120,10 " +
  "C148,10 156,30 156,52 " +
  "C156,72 148,88 136,92 " +
  "L140,108 " +
  "C158,110 176,118 184,128 " +
  "L188,168 " +
  "L190,236 " +
  "L188,266 " +
  "L186,338 " +
  "L190,378 " +
  "L194,418 " +
  "L180,422 L180,410 " +
  "L168,408 " +
  "L162,338 " +
  "L158,266 " +
  "L152,180 " +
  "L142,220 " +
  "L146,258 " +
  "L152,300 " +
  "L146,400 " +
  "L140,440 " +
  "L144,500 " +
  "L146,520 " +
  "L148,536 " +
  "L120,536 " +
  "L120,258 " +
  "L120,180 Z"

// Regions. Each "front" / "back" string is a path drawn over viewBox 240x540.
// Multiple sub-shapes (left + right) are concatenated into a single d="" so
// the entire region shares one fill on selection.
const REGIONS: RegionDef[] = [
  {
    key: "head",
    // Top half of skull (above face). On the back view it covers the full
    // back of the head.
    front:
      "M120,12 " +
      "C92,12 84,30 84,50 " +
      "L84,52 " +
      "L156,52 " +
      "L156,50 " +
      "C156,30 148,12 120,12 Z",
    back:
      "M120,12 " +
      "C92,12 84,30 84,50 " +
      "C84,72 92,88 120,90 " +
      "C148,88 156,72 156,50 " +
      "C156,30 148,12 120,12 Z",
  },
  {
    key: "face_jaw",
    // Front-only: lower half of head (cheeks + jaw).
    front:
      "M84,52 " +
      "L156,52 " +
      "C156,72 148,88 120,90 " +
      "C92,88 84,72 84,52 Z",
  },
  {
    key: "neck",
    front: "M104,90 L136,90 L140,110 L100,110 Z",
    back: "M104,90 L136,90 L140,110 L100,110 Z",
  },
  {
    key: "shoulders",
    // Two trapezoidal deltoid caps.
    front:
      "M100,108 C82,110 64,118 56,128 L60,158 L96,158 L96,118 Z " +
      "M140,108 C158,110 176,118 184,128 L180,158 L144,158 L144,118 Z",
    back:
      "M100,108 C82,110 64,118 56,128 L60,158 L96,158 L96,118 Z " +
      "M140,108 C158,110 176,118 184,128 L180,158 L144,158 L144,118 Z",
  },
  {
    key: "torso",
    front:
      // chest + abdomen, narrowing at waist
      "M96,118 L144,118 L152,160 L150,220 L140,258 L100,258 L90,220 L88,160 Z",
    back:
      // upper back + lower back
      "M96,118 L144,118 L152,160 L150,220 L140,258 L100,258 L90,220 L88,160 Z",
  },
  {
    key: "arms",
    // Upper arm + forearm on both sides. Elbow occupies the band between.
    front:
      "M52,162 L88,162 L86,236 L54,236 Z " +
      "M52,266 L82,266 L78,338 L54,338 Z " +
      "M152,162 L188,162 L186,236 L154,236 Z " +
      "M158,266 L188,266 L186,338 L162,338 Z",
    back:
      "M52,162 L88,162 L86,236 L54,236 Z " +
      "M52,266 L82,266 L78,338 L54,338 Z " +
      "M152,162 L188,162 L186,236 L154,236 Z " +
      "M158,266 L188,266 L186,338 L162,338 Z",
  },
  {
    key: "elbows",
    front:
      "M52,236 L86,236 L82,266 L54,266 Z " +
      "M154,236 L188,236 L186,266 L158,266 Z",
    back:
      "M52,236 L86,236 L82,266 L54,266 Z " +
      "M154,236 L188,236 L186,266 L158,266 Z",
  },
  {
    key: "hands",
    front:
      "M50,338 L78,338 L74,392 L52,392 Z " +
      "M162,338 L190,338 L188,392 L166,392 Z",
    back:
      "M50,338 L78,338 L74,392 L52,392 Z " +
      "M162,338 L190,338 L188,392 L166,392 Z",
  },
  {
    key: "fingers",
    // Splayed-finger fans at the hand tips.
    front:
      "M48,392 L78,392 L78,422 L72,422 L72,400 L66,400 L66,424 L60,424 L60,400 L54,400 L54,422 L48,422 Z " +
      "M162,392 L192,392 L192,422 L186,422 L186,400 L180,400 L180,424 L174,424 L174,400 L168,400 L168,422 L162,422 Z",
    back:
      "M48,392 L78,392 L78,422 L72,422 L72,400 L66,400 L66,424 L60,424 L60,400 L54,400 L54,422 L48,422 Z " +
      "M162,392 L192,392 L192,422 L186,422 L186,400 L180,400 L180,424 L174,424 L174,400 L168,400 L168,422 L162,422 Z",
  },
  {
    key: "hips",
    front: "M88,258 L152,258 L150,302 L90,302 Z",
    back: "M88,258 L152,258 L150,302 L90,302 Z",
  },
  {
    key: "upper_legs",
    front:
      "M90,302 L118,302 L116,402 L94,402 Z " +
      "M122,302 L150,302 L146,402 L124,402 Z",
    back:
      "M90,302 L118,302 L116,402 L94,402 Z " +
      "M122,302 L150,302 L146,402 L124,402 Z",
  },
  {
    key: "knees",
    front:
      "M94,402 L116,402 L116,438 L96,438 Z " +
      "M124,402 L146,402 L144,438 L124,438 Z",
    back:
      "M94,402 L116,402 L116,438 L96,438 Z " +
      "M124,402 L146,402 L144,438 L124,438 Z",
  },
  {
    key: "lower_legs",
    front:
      "M96,438 L116,438 L114,504 L98,504 Z " +
      "M124,438 L144,438 L142,504 L126,504 Z",
    back:
      "M96,438 L116,438 L114,504 L98,504 Z " +
      "M124,438 L144,438 L142,504 L126,504 Z",
  },
  {
    key: "ankles",
    front:
      "M98,504 L114,504 L114,522 L98,522 Z " +
      "M126,504 L142,504 L142,522 L126,522 Z",
    back:
      "M98,504 L114,504 L114,522 L98,522 Z " +
      "M126,504 L142,504 L142,522 L126,522 Z",
  },
  {
    key: "feet",
    // Front view: top of foot. Back view: heel.
    front:
      "M92,522 L116,522 L118,538 L90,538 Z " +
      "M124,522 L148,522 L150,538 L122,538 Z",
    back:
      "M92,522 L116,522 L118,538 L90,538 Z " +
      "M124,522 L148,522 L150,538 L122,538 Z",
  },
  // head_neck is legacy. The submission form no longer offers it, but if an
  // older report has selections.head_neck set, we render it over the head and
  // neck regions so it's still visible in the admin read-only view.
  {
    key: "head_neck",
    front:
      "M120,12 C92,12 84,30 84,50 C84,72 92,88 120,90 C148,88 156,72 156,50 C156,30 148,12 120,12 Z " +
      "M104,90 L136,90 L140,110 L100,110 Z",
    back:
      "M120,12 C92,12 84,30 84,50 C84,72 92,88 120,90 C148,88 156,72 156,50 C156,30 148,12 120,12 Z " +
      "M104,90 L136,90 L140,110 L100,110 Z",
  },
]

function fillForSide(side: BodySide, view: ViewName): string {
  if (side === "both") return "rgba(220,38,38,0.55)"
  if (side === view) return "rgba(220,38,38,0.55)"
  return "transparent"
}

function strokeForSide(side: BodySide, view: ViewName): string {
  if (side === "both" || side === view) return "rgb(185, 28, 28)"
  return "rgba(0,0,0,0.25)"
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
        {view === "front" ? "Front" : "Back"}
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
        {/* Silhouette backdrop, drawn as left + right halves. */}
        <path
          d={SILHOUETTE_PATH}
          fill="rgba(0,0,0,0.05)"
          stroke="rgba(0,0,0,0.25)"
          strokeWidth={1}
          strokeLinejoin="round"
        />
        <path
          d={SILHOUETTE_RIGHT_PATH}
          fill="rgba(0,0,0,0.05)"
          stroke="rgba(0,0,0,0.25)"
          strokeWidth={1}
          strokeLinejoin="round"
        />
        {/* Centerline + subtle waist line for visual cue */}
        <line
          x1={120}
          y1={12}
          x2={120}
          y2={538}
          stroke="rgba(0,0,0,0.05)"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
        {REGIONS.map((region) => {
          const d = view === "front" ? region.front : region.back
          if (!d) return null
          const side = selections[region.key]
          const label = `${BODY_PART_LABELS[region.key]} (${view})`
          return (
            <g
              key={region.key}
              aria-label={region.key}
              data-body-part={region.key}
            >
              <path
                d={d}
                fill={fillForSide(side, view)}
                stroke={strokeForSide(side, view)}
                strokeWidth={1.25}
                strokeLinejoin="round"
                onClick={() => handleClick(region.key)}
                style={{
                  cursor: readOnly ? "default" : "pointer",
                  pointerEvents: readOnly ? "none" : "auto",
                }}
              >
                <title>{label}</title>
              </path>
            </g>
          )
        })}
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
