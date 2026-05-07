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

type RegionDef = {
  key: BodyPartKey
  /**
   * Path "d" attribute for an approximate body region. Drawn over a 200x420
   * coordinate space; we hand-author rough humanoid silhouettes.
   */
  front: string
  back: string
}

/**
 * Hand-authored humanoid silhouette regions. Coords are in the 0..200 x 0..420
 * SVG viewBox. These don't need to be anatomically perfect; they need to be
 * recognizable + tappable. Each region is a closed path so we can fill it.
 */
const REGIONS: RegionDef[] = [
  {
    key: "head_neck",
    front:
      "M100,8 C82,8 70,24 70,46 C70,68 82,82 100,82 C118,82 130,68 130,46 C130,24 118,8 100,8 Z M86,82 L86,98 L114,98 L114,82 Z",
    back:
      "M100,8 C82,8 70,24 70,46 C70,68 82,82 100,82 C118,82 130,68 130,46 C130,24 118,8 100,8 Z M86,82 L86,98 L114,98 L114,82 Z",
  },
  {
    key: "torso",
    front:
      "M62,98 L138,98 L154,118 L154,210 L46,210 L46,118 Z",
    back:
      "M62,98 L138,98 L154,118 L154,210 L46,210 L46,118 Z",
  },
  {
    key: "arms",
    // Upper arms + shoulders, both sides
    front:
      "M40,108 L62,98 L62,180 L40,180 Z M138,98 L160,108 L160,180 L138,180 Z",
    back:
      "M40,108 L62,98 L62,180 L40,180 Z M138,98 L160,108 L160,180 L138,180 Z",
  },
  {
    key: "elbows",
    front:
      "M38,180 L62,180 L62,200 L38,200 Z M138,180 L162,180 L162,200 L138,200 Z",
    back:
      "M38,180 L62,180 L62,200 L38,200 Z M138,180 L162,180 L162,200 L138,200 Z",
  },
  {
    key: "hands",
    front:
      "M30,232 L62,232 L62,256 L30,256 Z M138,232 L170,232 L170,256 L138,256 Z",
    back:
      "M30,232 L62,232 L62,256 L30,256 Z M138,232 L170,232 L170,256 L138,256 Z",
  },
  {
    key: "fingers",
    front:
      "M30,256 L62,256 L62,278 L30,278 Z M138,256 L170,256 L170,278 L138,278 Z",
    back:
      "M30,256 L62,256 L62,278 L30,278 Z M138,256 L170,256 L170,278 L138,278 Z",
  },
  {
    key: "hips",
    front:
      "M46,210 L154,210 L154,238 L46,238 Z",
    back:
      "M46,210 L154,210 L154,238 L46,238 Z",
  },
  {
    key: "upper_legs",
    front:
      "M62,238 L98,238 L96,308 L66,308 Z M102,238 L138,238 L134,308 L104,308 Z",
    back:
      "M62,238 L98,238 L96,308 L66,308 Z M102,238 L138,238 L134,308 L104,308 Z",
  },
  {
    key: "knees",
    front:
      "M66,308 L96,308 L96,330 L66,330 Z M104,308 L134,308 L134,330 L104,330 Z",
    back:
      "M66,308 L96,308 L96,330 L66,330 Z M104,308 L134,308 L134,330 L104,330 Z",
  },
  {
    key: "lower_legs",
    front:
      "M66,330 L96,330 L94,388 L70,388 Z M104,330 L134,330 L130,388 L106,388 Z",
    back:
      "M66,330 L96,330 L94,388 L70,388 Z M104,330 L134,330 L130,388 L106,388 Z",
  },
  {
    key: "ankles",
    front:
      "M70,388 L94,388 L94,402 L70,402 Z M106,388 L130,388 L130,402 L106,402 Z",
    back:
      "M70,388 L94,388 L94,402 L70,402 Z M106,388 L130,388 L130,402 L106,402 Z",
  },
  {
    key: "feet",
    front:
      "M62,402 L98,402 L98,418 L62,418 Z M102,402 L138,402 L138,418 L102,418 Z",
    back:
      "M62,402 L98,402 L98,418 L62,418 Z M102,402 L138,402 L138,418 L102,418 Z",
  },
]

function fillForSide(side: BodySide, view: "front" | "back"): string {
  if (side === "both") return "rgba(220,38,38,0.55)" // red-600
  if (side === view) return "rgba(220,38,38,0.55)"
  return "transparent"
}

function strokeForSide(side: BodySide, view: "front" | "back"): string {
  if (side === "both" || side === view) return "rgb(185, 28, 28)"
  return "rgba(0,0,0,0.4)"
}

function ViewSvg({
  view,
  selections,
  onChange,
  readOnly,
  titleId,
}: {
  view: "front" | "back"
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
        viewBox="0 0 200 425"
        role="img"
        aria-labelledby={titleId}
        className="h-auto w-full max-w-[220px] touch-manipulation"
      >
        <title id={titleId}>
          {view === "front"
            ? "Front view of body. Tap a region to mark it as injured."
            : "Back view of body. Tap a region to mark it as injured."}
        </title>
        {/* Outer body silhouette as a backdrop */}
        <path
          d="M100,8 C82,8 70,24 70,46 C70,68 82,82 100,82 C118,82 130,68 130,46 C130,24 118,8 100,8 Z M86,82 L86,98 L62,98 L40,108 L40,200 L30,232 L30,278 L62,278 L62,238 L46,238 L46,118 L62,98 L138,98 L154,118 L154,238 L138,238 L138,278 L170,278 L170,232 L160,200 L160,108 L138,98 L114,98 L114,82 Z"
          fill="rgba(0,0,0,0.04)"
          stroke="rgba(0,0,0,0.2)"
          strokeWidth={1}
        />
        {REGIONS.map((region) => {
          const side = selections[region.key]
          const d = view === "front" ? region.front : region.back
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
                strokeWidth={1.5}
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

  const selectedEntries = BODY_PART_KEYS.filter(
    (key) => selections[key] !== "none"
  )

  const removeRow = (key: BodyPartKey) => {
    if (readOnly || !onChange) return
    onChange(key, "none")
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
        <div className="border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Selected body parts
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
            {BODY_PART_KEYS.map((key) => {
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
                    {(["front", "back", "both", "none"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => onChange?.(key, s)}
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
                    ))}
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
