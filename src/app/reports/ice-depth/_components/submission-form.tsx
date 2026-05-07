"use client"

import {
  useActionState,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import { submitIceDepthSession, type SubmissionFormState } from "../actions"
import type {
  LayoutForForm,
  PointForForm,
  Severity,
  SettingsForForm,
  SubmittedMeasurement,
} from "../types"

type Props = {
  layout: LayoutForForm
  points: PointForForm[]
  settings: SettingsForForm
}

const initialState: SubmissionFormState = {}

const SEVERITY_FILL: Record<Severity | "empty", string> = {
  empty: "fill-muted",
  ok: "fill-emerald-500",
  low: "fill-red-500",
  high: "fill-amber-500",
}

const SEVERITY_TEXT: Record<Severity, string> = {
  ok: "text-emerald-700 dark:text-emerald-300",
  low: "text-red-700 dark:text-red-300",
  high: "text-amber-700 dark:text-amber-300",
}

const SEVERITY_LABEL: Record<Severity, string> = {
  ok: "OK",
  low: "Low",
  high: "High",
}

function severityFor(
  rawValue: string,
  low: number,
  high: number
): Severity | null {
  const trimmed = rawValue.trim()
  if (trimmed === "") return null
  const v = Number(trimmed)
  if (!Number.isFinite(v)) return null
  if (v <= low) return "low"
  if (v > high) return "high"
  return "ok"
}

function stepForUnit(unit: string): number {
  const u = unit.toLowerCase()
  if (u === "mm" || u === "millimeters" || u === "millimetres") return 0.1
  return 0.01
}

export function SubmissionForm({ layout, points, settings }: Props) {
  const [state, formAction] = useActionState(
    submitIceDepthSession,
    initialState
  )

  // Pre-sort by sort_order then point_number for stable navigation.
  const sortedPoints = useMemo(() => {
    return [...points].sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
      return a.point_number - b.point_number
    })
  }, [points])

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(sortedPoints.map((p) => [p.id, ""]))
  )
  const [notes, setNotes] = useState("")

  const inputRefs = useRef<Map<string, HTMLInputElement | null>>(new Map())
  const baseId = useId()

  const setRef = useCallback(
    (pointId: string) => (el: HTMLInputElement | null) => {
      const map = inputRefs.current
      if (el) map.set(pointId, el)
      else map.delete(pointId)
    },
    []
  )

  const handleValueChange = useCallback(
    (pointId: string) => (e: ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value
      setValues((prev) => ({ ...prev, [pointId]: v }))
    },
    []
  )

  const focusPoint = useCallback((pointId: string) => {
    const el = inputRefs.current.get(pointId)
    if (el) {
      el.focus()
      el.select()
    }
  }, [])

  // Find next un-filled point in sort_order, starting AFTER currentPointId,
  // wrapping to the start. Returns null if all are filled.
  const findNextUnfilled = useCallback(
    (currentPointId: string, currentValues: Record<string, string>) => {
      const idx = sortedPoints.findIndex((p) => p.id === currentPointId)
      if (idx < 0) return null
      const n = sortedPoints.length
      for (let i = 1; i <= n; i += 1) {
        const p = sortedPoints[(idx + i) % n]
        if (p.id === currentPointId) continue
        const v = (currentValues[p.id] ?? "").trim()
        if (v === "") return p
      }
      return null
    },
    [sortedPoints]
  )

  const advanceFrom = useCallback(
    (pointId: string) => {
      const next = findNextUnfilled(pointId, values)
      if (next) {
        focusPoint(next.id)
      } else {
        // Everything is filled — blur to dismiss keyboard on mobile.
        inputRefs.current.get(pointId)?.blur()
      }
    },
    [findNextUnfilled, focusPoint, values]
  )

  const handleKeyDown = useCallback(
    (pointId: string) => (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault()
        advanceFrom(pointId)
      }
    },
    [advanceFrom]
  )

  useEffect(() => {
    if (state.error) {
      toast.error(state.error)
    }
  }, [state.error])

  // Build hidden measurements_json from non-empty values.
  const measurementsJson = useMemo(() => {
    const list: SubmittedMeasurement[] = []
    for (const p of sortedPoints) {
      const raw = (values[p.id] ?? "").trim()
      if (raw === "") continue
      const num = Number(raw)
      if (!Number.isFinite(num)) continue
      list.push({ point_id: p.id, depth_value: num })
    }
    return JSON.stringify(list)
  }, [sortedPoints, values])

  const filledCount = useMemo(() => {
    let n = 0
    for (const p of sortedPoints) {
      const raw = (values[p.id] ?? "").trim()
      if (raw === "") continue
      if (Number.isFinite(Number(raw))) n += 1
    }
    return n
  }, [sortedPoints, values])

  const aspect = layout.diagram_aspect_ratio || 0.425
  const step = stepForUnit(settings.measurement_unit)
  const unitLabel = settings.measurement_unit

  // Diagram in vertical orientation: width = aspect * height. We drive sizing
  // from CSS aspect-ratio so the SVG fills the container responsively.
  const VIEW_W = 1000
  const VIEW_H = Math.round(VIEW_W / aspect)
  // Point circle radius in viewBox units. Bumping to 44 gives ~44px tap
  // targets on typical mobile widths after scaling.
  const POINT_R = 44

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormError message={state.error} />

      {/* Hidden form fields the server action consumes. */}
      <input type="hidden" name="layout_id" value={layout.id} />
      <input type="hidden" name="layout_slug" value={layout.slug} />
      <input type="hidden" name="measurements_json" value={measurementsJson} />

      <div
        className="relative w-full overflow-hidden rounded-xl border bg-card"
        style={{ aspectRatio: String(aspect) }}
      >
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${layout.name} diagram with ${sortedPoints.length} measurement points`}
          className="absolute inset-0 h-full w-full touch-manipulation"
        >
          {/* Rink rectangle with rounded corners. */}
          <rect
            x={20}
            y={20}
            width={VIEW_W - 40}
            height={VIEW_H - 40}
            rx={Math.min(80, (VIEW_W - 40) / 4)}
            ry={Math.min(80, (VIEW_W - 40) / 4)}
            fill="white"
            stroke="rgba(0,0,0,0.4)"
            strokeWidth={4}
          />
          {/* Center red line (horizontal, across width). */}
          <line
            x1={20}
            x2={VIEW_W - 20}
            y1={VIEW_H / 2}
            y2={VIEW_H / 2}
            stroke="rgb(220,38,38)"
            strokeWidth={4}
          />

          {sortedPoints.map((p) => {
            const cx = p.x_position * VIEW_W
            const cy = p.y_position * VIEW_H
            const raw = values[p.id] ?? ""
            const sev = severityFor(
              raw,
              settings.low_threshold,
              settings.high_threshold
            )
            const fillClass = SEVERITY_FILL[sev ?? "empty"]
            const labelText = p.label
              ? `Point ${p.point_number} (${p.label})`
              : `Point ${p.point_number}`
            return (
              <g
                key={p.id}
                role="button"
                tabIndex={0}
                aria-label={`${labelText}. Tap to enter depth.`}
                onClick={() => focusPoint(p.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    focusPoint(p.id)
                  }
                }}
                style={{ cursor: "pointer", outline: "none" }}
              >
                <circle
                  cx={cx}
                  cy={cy}
                  r={POINT_R}
                  className={cn("transition-colors", fillClass)}
                  stroke="rgba(0,0,0,0.65)"
                  strokeWidth={3}
                />
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={POINT_R}
                  fontWeight={700}
                  fill="white"
                  pointerEvents="none"
                  style={{ userSelect: "none" }}
                >
                  {p.point_number}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>
          {filledCount} of {sortedPoints.length} filled
        </span>
        <span aria-hidden>•</span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
          Low ({"≤"} {settings.low_threshold})
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
          OK
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />
          High ({">"} {settings.high_threshold})
        </span>
      </div>

      <ul
        className="flex flex-col divide-y divide-border rounded-xl border bg-card"
        aria-label="Measurement points"
      >
        {sortedPoints.map((p) => {
          const raw = values[p.id] ?? ""
          const sev = severityFor(
            raw,
            settings.low_threshold,
            settings.high_threshold
          )
          const inputId = `${baseId}-point-${p.id}`
          const fillClass = SEVERITY_FILL[sev ?? "empty"].replace(
            "fill-",
            "bg-"
          )
          return (
            <li
              key={p.id}
              className="flex items-center gap-3 px-3 py-3"
            >
              <span
                aria-hidden
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white",
                  fillClass
                )}
              >
                {p.point_number}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <Label htmlFor={inputId} className="text-sm font-medium">
                  {p.label
                    ? `${p.label}`
                    : `Point ${p.point_number}`}
                </Label>
                {sev ? (
                  <span
                    className={cn(
                      "text-xs font-medium",
                      SEVERITY_TEXT[sev]
                    )}
                  >
                    {SEVERITY_LABEL[sev]}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Not entered
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  id={inputId}
                  ref={setRef(p.id)}
                  type="number"
                  inputMode="decimal"
                  enterKeyHint="next"
                  step={step}
                  min={0}
                  value={raw}
                  onChange={handleValueChange(p.id)}
                  onKeyDown={handleKeyDown(p.id)}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label={`Depth for point ${p.point_number}${
                    p.label ? ` (${p.label})` : ""
                  } in ${unitLabel}`}
                  className="h-12 w-24 text-base"
                />
                <span className="text-xs text-muted-foreground">
                  {unitLabel}
                </span>
              </div>
            </li>
          )
        })}
      </ul>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${baseId}-notes`}>Notes (optional)</Label>
        <Textarea
          id={`${baseId}-notes`}
          name="notes"
          rows={3}
          inputMode="text"
          enterKeyHint="done"
          placeholder="Anything worth flagging? Conditions, equipment, etc."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="min-h-24 text-base"
        />
      </div>

      <SubmitBar filledCount={filledCount} total={sortedPoints.length} />
    </form>
  )
}

function SubmitBar({
  filledCount,
  total,
}: {
  filledCount: number
  total: number
}) {
  const { pending } = useFormStatus()
  const label = pending
    ? "Submitting…"
    : filledCount === total
      ? "Submit ice depth report"
      : `Submit (${filledCount} of ${total})`
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending}
      className="h-12 w-full text-base"
    >
      {label}
    </Button>
  )
}
