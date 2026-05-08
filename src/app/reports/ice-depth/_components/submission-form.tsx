"use client"

import {
  useActionState,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import { USARink, rinkCoords, type RinkPointSpec } from "@/components/ice-depth/usa-rink"
import { Button } from "@/components/ui/button"
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

type Phase = "measure" | "review"

const initialState: SubmissionFormState = {}

// Severity colors consistent with the admin session detail view.
const SEVERITY_COLOR: Record<Severity, string> = {
  ok: "#16a34a",
  low: "#dc2626",
  high: "#d97706",
}

const SEVERITY_LABEL: Record<Severity, string> = {
  ok: "Optimal",
  low: "Below min",
  high: "Above target",
}

function severityFor(
  value: number,
  low: number,
  high: number,
): Severity | null {
  if (!Number.isFinite(value)) return null
  if (value <= low) return "low"
  if (value > high) return "high"
  return "ok"
}

export function SubmissionForm({ layout, points, settings }: Props) {
  const [state, formAction] = useActionState(
    submitIceDepthSession,
    initialState,
  )

  const sortedPoints = useMemo(() => {
    return [...points].sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
      return a.point_number - b.point_number
    })
  }, [points])

  const [phase, setPhase] = useState<Phase>("measure")
  const [currentIdx, setCurrentIdx] = useState(0)
  const [values, setValues] = useState<Record<string, string>>({})
  const [input, setInput] = useState("")
  const [notes, setNotes] = useState("")
  const baseId = useId()

  const currentPoint = sortedPoints[currentIdx]

  useEffect(() => {
    if (state.error) toast.error(state.error)
  }, [state.error])

  // When advancing to a new point, pre-fill if already has a value.
  const goToIdx = useCallback(
    (idx: number) => {
      setCurrentIdx(idx)
      const p = sortedPoints[idx]
      setInput(p ? (values[p.id] ?? "") : "")
    },
    [sortedPoints, values],
  )

  const commitCurrent = useCallback(() => {
    if (!currentPoint) return
    const trimmed = input.trim()
    if (trimmed !== "") {
      const num = Number(trimmed)
      if (Number.isFinite(num) && num >= 0) {
        setValues((prev) => ({ ...prev, [currentPoint.id]: trimmed }))
      }
    }
  }, [currentPoint, input])

  const handleNext = useCallback(() => {
    commitCurrent()
    if (currentIdx < sortedPoints.length - 1) {
      goToIdx(currentIdx + 1)
    } else {
      // Last point — go to review
      commitCurrent()
      setPhase("review")
    }
  }, [commitCurrent, currentIdx, goToIdx, sortedPoints.length])

  const handleSkip = useCallback(() => {
    if (currentIdx < sortedPoints.length - 1) {
      goToIdx(currentIdx + 1)
    } else {
      setPhase("review")
    }
  }, [currentIdx, goToIdx, sortedPoints.length])

  const handlePointClick = useCallback(
    (id: string) => {
      commitCurrent()
      const idx = sortedPoints.findIndex((p) => p.id === id)
      if (idx >= 0) goToIdx(idx)
    },
    [commitCurrent, goToIdx, sortedPoints],
  )

  const handleNumKey = useCallback((key: string) => {
    if (key === "⌫") {
      setInput((s) => s.slice(0, -1))
      return
    }
    setInput((s) => {
      if (key === "." && s.includes(".")) return s
      if ((s.replace(".", "").length >= 5) && key !== "⌫") return s
      return s + key
    })
  }, [])

  // Build measurements_json from current values (review phase includes
  // the current point's committed value).
  const committedValues = useMemo(() => {
    if (!currentPoint || phase === "review") return values
    const trimmed = input.trim()
    if (
      trimmed !== "" &&
      Number.isFinite(Number(trimmed)) &&
      Number(trimmed) >= 0
    ) {
      return { ...values, [currentPoint.id]: trimmed }
    }
    return values
  }, [values, currentPoint, input, phase])

  const measurementsJson = useMemo(() => {
    const list: SubmittedMeasurement[] = []
    for (const p of sortedPoints) {
      const raw = committedValues[p.id]?.trim()
      if (!raw) continue
      const num = Number(raw)
      if (Number.isFinite(num) && num >= 0)
        list.push({ point_id: p.id, depth_value: num })
    }
    return JSON.stringify(list)
  }, [sortedPoints, committedValues])

  const filledCount = useMemo(
    () =>
      sortedPoints.filter((p) => {
        const raw = committedValues[p.id]?.trim()
        return raw && Number.isFinite(Number(raw))
      }).length,
    [sortedPoints, committedValues],
  )

  // Stats for review
  const stats = useMemo(() => {
    const entries = sortedPoints
      .map((p) => {
        const raw = committedValues[p.id]?.trim()
        if (!raw) return null
        const n = Number(raw)
        return Number.isFinite(n) ? n : null
      })
      .filter((v): v is number => v !== null)

    if (entries.length === 0)
      return { avg: 0, ok: 0, low: 0, high: 0, total: 0 }
    const avg = entries.reduce((a, b) => a + b, 0) / entries.length
    const ok = entries.filter(
      (v) => v > settings.low_threshold && v <= settings.high_threshold,
    ).length
    const low = entries.filter((v) => v <= settings.low_threshold).length
    const high = entries.filter((v) => v > settings.high_threshold).length
    return { avg, ok, low, high, total: entries.length }
  }, [sortedPoints, committedValues, settings])

  // Build rink point specs
  const rinkPoints: RinkPointSpec[] = useMemo(() => {
    return sortedPoints.map((p, idx) => {
      const { cx, cy } = rinkCoords(p.x_position, p.y_position)
      const rawVal = committedValues[p.id]?.trim()
      const num = rawVal ? Number(rawVal) : NaN
      const sev = Number.isFinite(num) ? severityFor(num, settings.low_threshold, settings.high_threshold) : null

      let chipState: RinkPointSpec["state"]
      if (idx === currentIdx && phase === "measure") chipState = "current"
      else if (sev != null) chipState = "done"
      else chipState = "pending"

      return {
        id: p.id,
        pointNumber: p.point_number,
        cx,
        cy,
        state: chipState,
        doneColor: sev ? SEVERITY_COLOR[sev] : undefined,
        depthValue: Number.isFinite(num) ? num : null,
        onClick: () => handlePointClick(p.id),
      }
    })
  }, [sortedPoints, committedValues, currentIdx, phase, settings, handlePointClick])

  const liveNum = Number(input)
  const liveSev = Number.isFinite(liveNum) && input.trim() !== ""
    ? severityFor(liveNum, settings.low_threshold, settings.high_threshold)
    : null
  const liveColor = liveSev ? SEVERITY_COLOR[liveSev] : undefined

  const progress = filledCount / sortedPoints.length

  if (phase === "review") {
    return (
      <ReviewPhase
        layout={layout}
        sortedPoints={sortedPoints}
        committedValues={committedValues}
        settings={settings}
        stats={stats}
        rinkPoints={rinkPoints}
        notes={notes}
        setNotes={setNotes}
        measurementsJson={measurementsJson}
        formAction={formAction}
        stateError={state.error}
        onBack={() => {
          // Return to last point
          goToIdx(sortedPoints.length - 1)
          setPhase("measure")
        }}
        baseId={baseId}
      />
    )
  }

  // ── Measure phase ──────────────────────────────────────────────────────────
  const isLastPoint = currentIdx === sortedPoints.length - 1
  const hasInput = input.trim() !== "" && Number.isFinite(Number(input.trim()))

  return (
    <div className="flex flex-col gap-0">
      <FormError message={state.error} />

      {/* Progress bar */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${Math.max(progress * 100, 2)}%` }}
        />
      </div>

      {/* Step counter */}
      <div className="flex items-center justify-between py-2 text-xs text-muted-foreground">
        <span>
          Point {currentIdx + 1} of {sortedPoints.length}
        </span>
        <span>{filledCount} recorded</span>
      </div>

      {/* USA Hockey rink */}
      <div className="relative w-full" style={{ aspectRatio: "380/740" }}>
        <USARink
          points={rinkPoints}
          className="h-full w-full rounded-xl border"
          showValues
        />
      </div>

      {/* Reading display */}
      <div className="mt-3 flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
        {/* Point badge */}
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
          style={{ background: liveColor ?? "#002244" }}
        >
          {currentPoint?.point_number}
        </div>

        {/* Value display */}
        <div className="flex flex-1 flex-col">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {currentPoint?.label ? currentPoint.label : `Point ${currentPoint?.point_number}`}
          </span>
          <div className="flex items-baseline gap-1">
            <span
              className="font-mono text-3xl font-black leading-none"
              style={{ color: liveColor ?? (input ? "inherit" : undefined) }}
            >
              {input || "—"}
            </span>
            <span className="text-xs text-muted-foreground">
              {settings.measurement_unit}
            </span>
          </div>
          {liveSev && (
            <span
              className="text-[11px] font-semibold"
              style={{ color: liveColor }}
            >
              {SEVERITY_LABEL[liveSev]}
            </span>
          )}
        </div>

        {/* Skip */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleSkip}
          className="shrink-0 text-muted-foreground"
        >
          Skip
        </Button>
      </div>

      {/* Action button */}
      <Button
        type="button"
        size="lg"
        className="mt-2 h-12 w-full text-base"
        onClick={handleNext}
        disabled={!hasInput}
      >
        {isLastPoint ? "Review & Submit" : "Next Point →"}
      </Button>

      {/* Number pad */}
      <NumberPad onKey={handleNumKey} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Number pad
// ---------------------------------------------------------------------------

const PAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"] as const

function NumberPad({ onKey }: { onKey: (key: string) => void }) {
  return (
    <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl border bg-muted/30 p-3">
      {PAD_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onPointerDown={(e) => {
            e.preventDefault()
            onKey(key)
          }}
          className={cn(
            "flex h-14 items-center justify-center rounded-lg border bg-card text-xl font-semibold",
            "transition-colors active:bg-muted",
            key === "⌫" && "text-muted-foreground",
          )}
        >
          {key}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Review phase
// ---------------------------------------------------------------------------

interface ReviewPhaseProps {
  layout: LayoutForForm
  sortedPoints: PointForForm[]
  committedValues: Record<string, string>
  settings: SettingsForForm
  stats: { avg: number; ok: number; low: number; high: number; total: number }
  rinkPoints: RinkPointSpec[]
  notes: string
  setNotes: (v: string) => void
  measurementsJson: string
  formAction: (payload: FormData) => void
  stateError?: string
  onBack: () => void
  baseId: string
}

function ReviewPhase({
  layout,
  sortedPoints,
  committedValues,
  settings,
  stats,
  rinkPoints,
  notes,
  setNotes,
  measurementsJson,
  formAction,
  stateError,
  onBack,
  baseId,
}: ReviewPhaseProps) {
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError message={stateError} />

      <input type="hidden" name="layout_id" value={layout.id} />
      <input type="hidden" name="layout_slug" value={layout.slug} />
      <input type="hidden" name="measurements_json" value={measurementsJson} />
      <input type="hidden" name="notes" value={notes} />

      {/* Summary card */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-start gap-4">
          {/* Rink thumbnail */}
          <div className="w-24 shrink-0" style={{ aspectRatio: "380/740" }}>
            <USARink
              points={rinkPoints.map((p) => ({ ...p, onClick: undefined }))}
              showValues
              className="rounded-lg border"
            />
          </div>

          {/* Stats */}
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Average depth
              </span>
              <div className="flex items-baseline gap-1">
                <span className="font-mono text-3xl font-black leading-none">
                  {stats.avg.toFixed(2)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {settings.measurement_unit}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {stats.ok > 0 && (
                <SummaryPill color="#16a34a">{stats.ok} optimal</SummaryPill>
              )}
              {stats.high > 0 && (
                <SummaryPill color="#d97706">{stats.high} thick</SummaryPill>
              )}
              {stats.low > 0 && (
                <SummaryPill color="#dc2626">{stats.low} below min</SummaryPill>
              )}
              {stats.total < sortedPoints.length && (
                <SummaryPill color="#6b7280">
                  {sortedPoints.length - stats.total} skipped
                </SummaryPill>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Per-point list */}
      <ul className="flex flex-col divide-y divide-border rounded-xl border bg-card">
        {sortedPoints.map((p) => {
          const raw = committedValues[p.id]?.trim()
          const num = raw ? Number(raw) : NaN
          const sev = Number.isFinite(num)
            ? severityFor(num, settings.low_threshold, settings.high_threshold)
            : null

          return (
            <li
              key={p.id}
              className="flex items-center gap-3 px-3 py-2.5"
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{
                  background: sev ? SEVERITY_COLOR[sev] : "#94a3b8",
                }}
              >
                {p.point_number}
              </span>
              <div className="flex flex-1 flex-col">
                <span className="text-sm font-medium">
                  {p.label ?? `Point ${p.point_number}`}
                </span>
                <span
                  className="text-xs"
                  style={{ color: sev ? SEVERITY_COLOR[sev] : "#94a3b8" }}
                >
                  {sev ? SEVERITY_LABEL[sev] : "Not recorded"}
                </span>
              </div>
              <span className="font-mono text-sm font-semibold">
                {Number.isFinite(num) ? `${num.toFixed(2)} ${settings.measurement_unit}` : "—"}
              </span>
            </li>
          )
        })}
      </ul>

      {/* Notes */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${baseId}-notes`}
          className="text-sm font-medium"
        >
          Notes (optional)
        </label>
        <Textarea
          id={`${baseId}-notes`}
          rows={3}
          inputMode="text"
          placeholder="Anything worth flagging? Conditions, equipment, resurface schedule…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="min-h-20 text-base"
        />
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <SubmitButton filledCount={stats.total} total={sortedPoints.length} />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-muted-foreground"
        >
          ← Back to measure
        </Button>
      </div>
    </form>
  )
}

function SummaryPill({
  color,
  children,
}: {
  color: string
  children: React.ReactNode
}) {
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white"
      style={{ background: color }}
    >
      {children}
    </span>
  )
}

function SubmitButton({
  filledCount,
  total,
}: {
  filledCount: number
  total: number
}) {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending}
      className="h-12 w-full text-base"
    >
      {pending
        ? "Submitting…"
        : filledCount === total
          ? "Submit reading"
          : `Submit (${filledCount} of ${total} recorded)`}
    </Button>
  )
}
