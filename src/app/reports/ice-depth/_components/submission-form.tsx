"use client"

import {
  useActionState,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import {
  RINK_H,
  RINK_W,
  USARink,
  rinkCoords,
  type RinkPointSpec,
} from "@/components/ice-depth/usa-rink"
import { Textarea } from "@/components/ui/textarea"

import { submitIceDepthSession, type SubmissionFormState } from "../actions"
import type {
  LayoutForForm,
  PointForForm,
  Severity,
  SettingsForForm,
  SubmittedMeasurement,
} from "../types"

// ── Types & constants ─────────────────────────────────────────────────────────

type Props = {
  layout: LayoutForForm
  points: PointForForm[]
  settings: SettingsForForm
}

type Phase = "measure" | "review"

const initialState: SubmissionFormState = {}

const SEVERITY_COLOR: Record<Severity, string> = {
  ok:   "#4DFF00",  // action green
  low:  "#F42A2A",  // alert red
  high: "#FFB800",  // alert yellow
}

const SEVERITY_LABEL: Record<Severity, string> = {
  ok:   "Optimal",
  low:  "Below min",
  high: "Above target",
}

const DISPLAY_FONT =
  "var(--font-anton), Anton, Impact, 'Arial Narrow', sans-serif"

const NAVY = "#003B6F"
const GREEN = "#4DFF00"
const GREEN_PRESS = "#2E9900"

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

// ── Main form component ───────────────────────────────────────────────────────

export function SubmissionForm({ layout, points, settings }: Props) {
  const [state, formAction] = useActionState(submitIceDepthSession, initialState)

  const sortedPoints = useMemo(() => {
    return [...points].sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
      return a.point_number - b.point_number
    })
  }, [points])

  const [phase, setPhase] = useState<Phase>("measure")
  const [currentIdx, setCurrentIdx] = useState(0)
  const [values, setValues] = useState<Record<string, string>>({})
  const [popoverValue, setPopoverValue] = useState("")
  const [popoverOpen, setPopoverOpen] = useState(true)
  const [notes, setNotes] = useState("")
  const baseId = useId()
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const currentPoint = sortedPoints[currentIdx]

  useEffect(() => {
    if (state.error) toast.error(state.error)
  }, [state.error])

  useEffect(() => {
    if (!popoverOpen || phase !== "measure") return
    const raf = requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.select()
    })
    return () => cancelAnimationFrame(raf)
  }, [popoverOpen, currentIdx, phase])

  const isValidDepth = (raw: string) => {
    const trimmed = raw.trim()
    if (trimmed === "") return false
    const n = Number(trimmed)
    return Number.isFinite(n) && n >= 0
  }

  const saveValue = useCallback(
    (pointId: string, raw: string) => {
      const trimmed = raw.trim()
      if (!isValidDepth(trimmed)) return false
      setValues((prev) => ({ ...prev, [pointId]: trimmed }))
      return true
    },
    [],
  )

  const goToIdx = useCallback(
    (idx: number) => {
      setCurrentIdx(idx)
      const p = sortedPoints[idx]
      setPopoverValue(p ? (values[p.id] ?? "") : "")
      setPopoverOpen(true)
    },
    [sortedPoints, values],
  )

  const advance = useCallback(() => {
    if (currentIdx < sortedPoints.length - 1) {
      goToIdx(currentIdx + 1)
    } else {
      setPhase("review")
    }
  }, [currentIdx, sortedPoints.length, goToIdx])

  const handleEnter = useCallback(() => {
    if (!currentPoint) return
    saveValue(currentPoint.id, popoverValue)
    advance()
  }, [advance, currentPoint, popoverValue, saveValue])

  const handleEscape = useCallback(() => {
    setPopoverOpen(false)
  }, [])

  const handleSkip = useCallback(() => {
    advance()
  }, [advance])

  const handlePointClick = useCallback(
    (id: string) => {
      if (currentPoint && popoverOpen) {
        saveValue(currentPoint.id, popoverValue)
      }
      const idx = sortedPoints.findIndex((p) => p.id === id)
      if (idx >= 0) goToIdx(idx)
    },
    [currentPoint, goToIdx, popoverOpen, popoverValue, saveValue, sortedPoints],
  )

  const handleGoToReview = useCallback(() => {
    if (currentPoint) saveValue(currentPoint.id, popoverValue)
    setPhase("review")
  }, [currentPoint, popoverValue, saveValue])

  // Click-outside: commit the in-flight value (if valid) and close the popover.
  // Clicks on a point chip will close us, then the chip's onClick will reopen
  // the popover on the new point via the currentIdx → useEffect chain.
  useEffect(() => {
    if (!popoverOpen || phase !== "measure") return
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node | null
      if (!target) return
      if (popoverRef.current && popoverRef.current.contains(target)) return
      if (currentPoint) saveValue(currentPoint.id, popoverValue)
      setPopoverOpen(false)
    }
    document.addEventListener("mousedown", onMouseDown)
    return () => document.removeEventListener("mousedown", onMouseDown)
  }, [popoverOpen, phase, currentPoint, popoverValue, saveValue])

  const committedValues = useMemo(() => {
    if (!currentPoint || phase === "review" || !popoverOpen) return values
    const trimmed = popoverValue.trim()
    if (isValidDepth(trimmed)) {
      return { ...values, [currentPoint.id]: trimmed }
    }
    return values
  }, [values, currentPoint, popoverValue, phase, popoverOpen])

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

  const rinkPoints: RinkPointSpec[] = useMemo(() => {
    return sortedPoints.map((p, idx) => {
      const { cx, cy } = rinkCoords(p.x_position, p.y_position)
      const rawVal = committedValues[p.id]?.trim()
      const num = rawVal ? Number(rawVal) : NaN
      const sev = Number.isFinite(num)
        ? severityFor(num, settings.low_threshold, settings.high_threshold)
        : null

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

  const liveTrimmed = popoverValue.trim()
  const liveNum = Number(liveTrimmed)
  const liveSev =
    liveTrimmed !== "" && Number.isFinite(liveNum)
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
          goToIdx(sortedPoints.length - 1)
          setPhase("measure")
        }}
        baseId={baseId}
      />
    )
  }

  // ── Measure phase ─────────────────────────────────────────────────────────

  const isLastPoint = currentIdx === sortedPoints.length - 1
  const hasInput = isValidDepth(popoverValue)
  const reviewEnabled = filledCount > 0

  const currentChip = currentPoint
    ? rinkCoords(currentPoint.x_position, currentPoint.y_position)
    : null
  const popoverAbove = currentChip ? currentChip.cy > RINK_H / 2 : true

  return (
    <div className="flex flex-col gap-0">
      <FormError message={state.error} />

      {/* Module sub-header: point progress */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 0 8px",
          gap: 12,
        }}
      >
        <div
          style={{
            fontFamily: DISPLAY_FONT,
            fontSize: 13,
            fontWeight: 900,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "#4DFF00",
          }}
        >
          Point {currentIdx + 1} of {sortedPoints.length}
        </div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--muted-foreground)",
          }}
        >
          {filledCount} recorded
        </div>
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: 4,
          width: "100%",
          background: "rgba(255,255,255,0.08)",
          borderRadius: 9999,
          overflow: "hidden",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.max(progress * 100, 2)}%`,
            background: `linear-gradient(to right, ${GREEN}, #7AFF40)`,
            borderRadius: 9999,
            transition: "width 0.3s cubic-bezier(.4,0,.2,1)",
          }}
        />
      </div>

      {/* USA Hockey rink — edge-to-edge feel on mobile */}
      <div
        className="relative w-full"
        style={{
          aspectRatio: "380/740",
          borderRadius: 12,
          overflow: "visible",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <USARink
            points={rinkPoints}
            className="h-full w-full"
            showValues
            logoUrl={layout.logo_url}
          />
        </div>

        {/* Anchored input popover over the active point */}
        {popoverOpen && currentPoint && currentChip && (
          <PointPopover
            ref={popoverRef}
            inputRef={inputRef}
            pointNumber={currentPoint.point_number}
            label={currentPoint.label}
            unit={settings.measurement_unit}
            value={popoverValue}
            onChange={setPopoverValue}
            onEnter={handleEnter}
            onEscape={handleEscape}
            onSkip={handleSkip}
            liveColor={liveColor}
            liveSeverityLabel={liveSev ? SEVERITY_LABEL[liveSev] : null}
            xPct={(currentChip.cx / RINK_W) * 100}
            yPct={(currentChip.cy / RINK_H) * 100}
            above={popoverAbove}
            canSave={hasInput}
            isLast={isLastPoint}
          />
        )}
      </div>

      {/* Helper text */}
      <p
        style={{
          marginTop: 12,
          fontSize: 12,
          color: "var(--muted-foreground)",
          textAlign: "center",
        }}
      >
        Tap a point to edit. Press <kbd style={KBD_STYLE}>Enter</kbd> to save and
        move to the next. <kbd style={KBD_STYLE}>Esc</kbd> closes.
      </p>

      {/* Review button */}
      <button
        type="button"
        onClick={handleGoToReview}
        disabled={!reviewEnabled}
        style={{
          marginTop: 8,
          width: "100%",
          minHeight: 52,
          borderRadius: 10,
          border: 0,
          background: reviewEnabled
            ? `linear-gradient(180deg, #7AFF40 0%, ${GREEN} 100%)`
            : "var(--muted)",
          color: reviewEnabled ? "#051200" : "var(--muted-foreground)",
          fontFamily: DISPLAY_FONT,
          fontSize: 18,
          fontWeight: 900,
          letterSpacing: "0.02em",
          textTransform: "uppercase",
          cursor: reviewEnabled ? "pointer" : "not-allowed",
          boxShadow: reviewEnabled
            ? `0 2px 0 0 ${GREEN_PRESS}, 0 4px 12px rgba(77,255,0,0.25)`
            : "none",
          transition: "background 0.15s, box-shadow 0.15s, color 0.15s",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        Review &amp; Submit
        {reviewEnabled && (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        )}
      </button>
    </div>
  )
}

// ── Anchored point popover ────────────────────────────────────────────────────

const KBD_STYLE: React.CSSProperties = {
  display: "inline-block",
  padding: "1px 5px",
  borderRadius: 4,
  background: "var(--muted)",
  color: "var(--foreground)",
  border: "1px solid var(--border)",
  fontFamily: "var(--font-geist-mono), monospace",
  fontSize: 11,
  lineHeight: 1.4,
}

type PointPopoverProps = {
  ref: React.RefObject<HTMLDivElement | null>
  inputRef: React.RefObject<HTMLInputElement | null>
  pointNumber: number
  label: string | null
  unit: string
  value: string
  onChange: (v: string) => void
  onEnter: () => void
  onEscape: () => void
  onSkip: () => void
  liveColor?: string
  liveSeverityLabel: string | null
  xPct: number
  yPct: number
  above: boolean
  canSave: boolean
  isLast: boolean
}

function PointPopover({
  ref,
  inputRef,
  pointNumber,
  label,
  unit,
  value,
  onChange,
  onEnter,
  onEscape,
  onSkip,
  liveColor,
  liveSeverityLabel,
  xPct,
  yPct,
  above,
  canSave,
  isLast,
}: PointPopoverProps) {
  // Sit above or below the chip with a small gap, centered horizontally on it.
  const yOffset = above ? "calc(-100% - 22px)" : "22px"

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Enter depth for point ${pointNumber}`}
      style={{
        position: "absolute",
        left: `${xPct}%`,
        top: `${yPct}%`,
        transform: `translate(-50%, ${yOffset})`,
        zIndex: 30,
        minWidth: 200,
        maxWidth: 240,
        background: "var(--card)",
        border: `1px solid ${liveColor ?? "var(--border)"}`,
        borderRadius: 10,
        padding: 10,
        boxShadow:
          "0 12px 30px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.25)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 9999,
            background: liveColor ?? NAVY,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: DISPLAY_FONT,
            fontSize: 14,
            fontWeight: 900,
            flexShrink: 0,
          }}
        >
          {pointNumber}
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--muted-foreground)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label ?? `Point ${pointNumber}`}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => {
            const next = e.target.value
            if (next === "" || /^[0-9]*\.?[0-9]{0,3}$/.test(next)) {
              onChange(next)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              onEnter()
            } else if (e.key === "Escape") {
              e.preventDefault()
              onEscape()
            }
          }}
          placeholder="0.0"
          style={{
            flex: 1,
            minWidth: 0,
            height: 40,
            padding: "0 10px",
            borderRadius: 8,
            border: `1px solid ${liveColor ?? "var(--border)"}`,
            background: "var(--background)",
            color: "var(--foreground)",
            fontFamily: DISPLAY_FONT,
            fontSize: 22,
            fontVariantNumeric: "tabular-nums",
            outline: "none",
          }}
        />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--muted-foreground)",
          }}
        >
          {unit}
        </span>
      </div>

      {liveSeverityLabel && (
        <div
          style={{
            marginTop: 6,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: liveColor,
          }}
        >
          {liveSeverityLabel}
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 6,
          marginTop: 8,
        }}
      >
        <button
          type="button"
          onClick={onSkip}
          style={{
            flex: "0 0 auto",
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--muted-foreground)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Skip
        </button>
        <button
          type="button"
          onClick={onEnter}
          disabled={!canSave}
          style={{
            flex: 1,
            padding: "6px 10px",
            borderRadius: 6,
            border: 0,
            background: canSave
              ? `linear-gradient(180deg, #7AFF40 0%, ${GREEN} 100%)`
              : "var(--muted)",
            color: canSave ? "#051200" : "var(--muted-foreground)",
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            cursor: canSave ? "pointer" : "not-allowed",
          }}
        >
          {isLast ? "Save & Review" : "Save & Next"}
        </button>
      </div>
    </div>
  )
}

// ── Review phase ──────────────────────────────────────────────────────────────

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

      {/* Review header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: -4,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
            width: 34,
            height: 34,
            borderRadius: 9999,
            border: "1px solid var(--border)",
            background: "var(--muted)",
            color: "var(--foreground)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--muted-foreground)",
            }}
          >
            Step 3 of 3
          </div>
          <div
            style={{
              fontFamily: DISPLAY_FONT,
              fontSize: 22,
              lineHeight: 1,
              letterSpacing: "0.01em",
              textTransform: "uppercase",
              color: "var(--foreground)",
            }}
          >
            Review &amp; Submit
          </div>
        </div>
      </div>

      {/* Summary card */}
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          {/* Rink thumbnail */}
          <div className="w-24 shrink-0" style={{ aspectRatio: "380/740" }}>
            <USARink
              points={rinkPoints.map((p) => ({ ...p, onClick: undefined }))}
              showValues
              className="rounded-lg border"
              logoUrl={layout.logo_url}
            />
          </div>

          {/* Stats */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--muted-foreground)",
                  marginBottom: 2,
                }}
              >
                Average depth
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span
                  style={{
                    fontFamily: DISPLAY_FONT,
                    fontSize: 36,
                    lineHeight: 1,
                    color: "var(--foreground)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {stats.avg.toFixed(2)}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--muted-foreground)",
                  }}
                >
                  {settings.measurement_unit}
                </span>
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {stats.ok > 0 && (
                <SummaryPill color={SEVERITY_COLOR.ok}>{stats.ok} optimal</SummaryPill>
              )}
              {stats.high > 0 && (
                <SummaryPill color={SEVERITY_COLOR.high}>{stats.high} thick</SummaryPill>
              )}
              {stats.low > 0 && (
                <SummaryPill color={SEVERITY_COLOR.low}>{stats.low} below min</SummaryPill>
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
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {sortedPoints.map((p, i) => {
          const raw = committedValues[p.id]?.trim()
          const num = raw ? Number(raw) : NaN
          const sev = Number.isFinite(num)
            ? severityFor(num, settings.low_threshold, settings.high_threshold)
            : null

          return (
            <li
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                borderBottom:
                  i < sortedPoints.length - 1
                    ? "1px solid var(--border)"
                    : "none",
              }}
            >
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 9999,
                  background: sev ? SEVERITY_COLOR[sev] : "var(--muted)",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                {p.point_number}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
                  {p.label ?? `Point ${p.point_number}`}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: sev ? SEVERITY_COLOR[sev] : "var(--muted-foreground)",
                    fontWeight: sev ? 700 : 400,
                  }}
                >
                  {sev ? SEVERITY_LABEL[sev] : "Not recorded"}
                </div>
              </div>
              <span
                style={{
                  fontVariantNumeric: "tabular-nums",
                  fontSize: 13,
                  fontWeight: 700,
                  color: Number.isFinite(num)
                    ? "var(--foreground)"
                    : "var(--muted-foreground)",
                  fontFamily: "var(--font-geist-mono), monospace",
                }}
              >
                {Number.isFinite(num)
                  ? `${num.toFixed(2)} ${settings.measurement_unit}`
                  : "—"}
              </span>
            </li>
          )
        })}
      </ul>

      {/* Notes */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label
          htmlFor={`${baseId}-notes`}
          style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}
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
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SubmitButton filledCount={stats.total} total={sortedPoints.length} />
        <button
          type="button"
          onClick={onBack}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: 0,
            background: "transparent",
            color: "var(--muted-foreground)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          ← Back to measure
        </button>
      </div>
    </form>
  )
}

// ── Summary pill ──────────────────────────────────────────────────────────────

function SummaryPill({
  color,
  children,
}: {
  color: string
  children: React.ReactNode
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: 9999,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        background: `${color}22`,
        color: color,
        border: `1px solid ${color}44`,
      }}
    >
      {children}
    </span>
  )
}

// ── Submit button ─────────────────────────────────────────────────────────────

function SubmitButton({
  filledCount,
  total,
}: {
  filledCount: number
  total: number
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      style={{
        width: "100%",
        minHeight: 52,
        borderRadius: 10,
        border: 0,
        background: pending
          ? "var(--muted)"
          : `linear-gradient(180deg, #7AFF40 0%, ${GREEN} 100%)`,
        color: pending ? "var(--muted-foreground)" : "#051200",
        fontFamily: DISPLAY_FONT,
        fontSize: 18,
        fontWeight: 900,
        letterSpacing: "0.02em",
        textTransform: "uppercase",
        cursor: pending ? "not-allowed" : "pointer",
        boxShadow: pending
          ? "none"
          : `0 2px 0 0 ${GREEN_PRESS}, 0 4px 12px rgba(77,255,0,0.25)`,
        transition: "background 0.15s, box-shadow 0.15s",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
    >
      {pending
        ? "Submitting…"
        : filledCount === total
          ? "Submit Reading"
          : `Submit (${filledCount} of ${total} recorded)`}
      {!pending && (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
    </button>
  )
}
