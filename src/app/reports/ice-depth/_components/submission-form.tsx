"use client"

import {
  useActionState,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react"
import { useFormStatus } from "react-dom"
import { Bluetooth } from "lucide-react"
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
import { enqueueSubmission, useSyncQueue } from "@/lib/offline/use-sync-queue"
import { genLocalId } from "@/lib/offline/local-id"

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

  const { isOnline } = useSyncQueue()
  const [localId] = useState<string>(genLocalId)
  const [queued, setQueued] = useState(false)
  const [offlineError, setOfflineError] = useState<string | null>(null)

  const sortedPoints = useMemo(() => {
    return [...points].sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
      return a.point_number - b.point_number
    })
  }, [points])

  const [phase, setPhase] = useState<Phase>("measure")
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [draftValue, setDraftValue] = useState("")
  const [notes, setNotes] = useState("")
  const baseId = useId()
  const skipBlurSaveRef = useRef(false)

  const editingPoint =
    editingIdx != null ? (sortedPoints[editingIdx] ?? null) : null

  useEffect(() => {
    if (state.error) toast.error(state.error)
  }, [state.error])

  const isValidDepth = (raw: string) => {
    const trimmed = raw.trim()
    if (trimmed === "") return false
    const n = Number(trimmed)
    return Number.isFinite(n) && n >= 0
  }

  const commitDraft = useCallback(
    (pointId: string, raw: string) => {
      const trimmed = raw.trim()
      if (!isValidDepth(trimmed)) return false
      setValues((prev) => ({ ...prev, [pointId]: trimmed }))
      return true
    },
    [],
  )

  const openPopover = useCallback(
    (idx: number) => {
      const p = sortedPoints[idx]
      if (!p) return
      setEditingIdx(idx)
      setDraftValue(values[p.id] ?? "")
    },
    [sortedPoints, values],
  )

  const closePopover = useCallback(() => {
    skipBlurSaveRef.current = true
    setEditingIdx(null)
  }, [])

  const handleEnter = useCallback(() => {
    if (!editingPoint || editingIdx == null) return
    commitDraft(editingPoint.id, draftValue)
    skipBlurSaveRef.current = true
    if (editingIdx >= sortedPoints.length - 1) {
      setEditingIdx(null)
      setPhase("review")
    } else {
      openPopover(editingIdx + 1)
    }
  }, [commitDraft, draftValue, editingIdx, editingPoint, openPopover, sortedPoints.length])

  const handleEscape = useCallback(() => {
    closePopover()
  }, [closePopover])

  const handleSkip = useCallback(() => {
    if (editingIdx == null) return
    skipBlurSaveRef.current = true
    if (editingIdx >= sortedPoints.length - 1) {
      setEditingIdx(null)
      setPhase("review")
    } else {
      openPopover(editingIdx + 1)
    }
  }, [editingIdx, openPopover, sortedPoints.length])

  // Click-outside is handled by the input's onBlur: when focus leaves the
  // input for any reason (clicking elsewhere on the page, tabbing away, the
  // chip onClick taking focus), we save and close. handleEnter/handleEscape
  // set skipBlurSaveRef before triggering state changes so the blur from the
  // unmounting input doesn't double-process.
  const handleBlur = useCallback(() => {
    if (skipBlurSaveRef.current) {
      skipBlurSaveRef.current = false
      return
    }
    if (!editingPoint) return
    commitDraft(editingPoint.id, draftValue)
    setEditingIdx(null)
  }, [commitDraft, draftValue, editingPoint])

  const handlePointClick = useCallback(
    (id: string) => {
      const idx = sortedPoints.findIndex((p) => p.id === id)
      if (idx < 0) return
      // If a popover is already open for a different point, the input's blur
      // fires first and saves it. We just need to set the new editing target.
      openPopover(idx)
    },
    [openPopover, sortedPoints],
  )

  const handleGoToReview = useCallback(() => {
    if (editingPoint) commitDraft(editingPoint.id, draftValue)
    skipBlurSaveRef.current = true
    setEditingIdx(null)
    setPhase("review")
  }, [commitDraft, draftValue, editingPoint])

  const committedValues = useMemo(() => {
    if (!editingPoint || phase === "review") return values
    const trimmed = draftValue.trim()
    if (isValidDepth(trimmed)) {
      return { ...values, [editingPoint.id]: trimmed }
    }
    return values
  }, [values, editingPoint, draftValue, phase])

  const measurementsArray = useMemo(() => {
    const list: SubmittedMeasurement[] = []
    for (const p of sortedPoints) {
      const raw = committedValues[p.id]?.trim()
      if (!raw) continue
      const num = Number(raw)
      if (Number.isFinite(num) && num >= 0)
        list.push({ point_id: p.id, depth_value: num })
    }
    return list
  }, [sortedPoints, committedValues])

  const measurementsJson = useMemo(
    () => JSON.stringify(measurementsArray),
    [measurementsArray],
  )

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
    return sortedPoints.map((p) => {
      const { cx, cy } = rinkCoords(p.x_position, p.y_position)
      const rawVal = committedValues[p.id]?.trim()
      const num = rawVal ? Number(rawVal) : NaN
      const sev = Number.isFinite(num)
        ? severityFor(num, settings.low_threshold, settings.high_threshold)
        : null

      let chipState: RinkPointSpec["state"]
      if (p.id === editingPoint?.id && phase === "measure") chipState = "current"
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
  }, [sortedPoints, committedValues, editingPoint, phase, settings, handlePointClick])

  const liveTrimmed = draftValue.trim()
  const liveNum = Number(liveTrimmed)
  const liveSev =
    liveTrimmed !== "" && Number.isFinite(liveNum)
      ? severityFor(liveNum, settings.low_threshold, settings.high_threshold)
      : null
  const liveColor = liveSev ? SEVERITY_COLOR[liveSev] : undefined

  const progress = filledCount / sortedPoints.length

  // Offline submit: serialize the measured session into the SAME payload shape
  // `buildInputFromPayload` parses and queue it in the service worker, which
  // replays to /api/offline-sync (running the same validation/severity engine)
  // once back online. enqueueSubmission only succeeds when a SW is controlling
  // the page; if it isn't, we must NOT fall through to the server action — the
  // browser already reports itself offline, so that POST would just fail with a
  // confusing network error. Block the submit and tell the user plainly instead
  // of showing a false "Saved on this device".
  const handleReviewSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      e.preventDefault()
      const ok = enqueueSubmission({
        localId,
        moduleKey: "ice_depth",
        action: "submit",
        payload: {
          layout_id: layout.id,
          layout_slug: layout.slug,
          notes: notes.trim() || null,
          measurements: measurementsArray,
        },
      })
      if (ok) {
        setOfflineError(null)
        setQueued(true)
      } else {
        setOfflineError(
          "This device can't save offline yet. Reconnect to submit, or reload the page and try again — your readings are still here.",
        )
      }
    }
  }

  if (queued) {
    return <QueuedConfirmation />
  }

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
        onSubmit={handleReviewSubmit}
        isOnline={isOnline}
        stateError={offlineError ?? state.error}
        onBack={() => {
          setPhase("measure")
          openPopover(sortedPoints.length - 1)
        }}
        baseId={baseId}
      />
    )
  }

  // ── Measure phase ─────────────────────────────────────────────────────────

  const isLastPoint =
    editingIdx != null && editingIdx === sortedPoints.length - 1
  const hasInput = isValidDepth(draftValue)
  const reviewEnabled = filledCount > 0

  const editingChip = editingPoint
    ? rinkCoords(editingPoint.x_position, editingPoint.y_position)
    : null
  const popoverAbove = editingChip ? editingChip.cy > RINK_H / 2 : true

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
          {editingIdx != null
            ? `Point ${editingIdx + 1} of ${sortedPoints.length}`
            : `${sortedPoints.length} points — tap to enter`}
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
        role="progressbar"
        aria-label="Points recorded"
        aria-valuemin={0}
        aria-valuemax={sortedPoints.length}
        aria-valuenow={filledCount}
        aria-valuetext={`${filledCount} of ${sortedPoints.length} points recorded`}
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
          aria-hidden
          style={{
            height: "100%",
            width: `${Math.max(progress * 100, 2)}%`,
            background: `linear-gradient(to right, ${GREEN}, #7AFF40)`,
            borderRadius: 9999,
            transition: "width 0.3s cubic-bezier(.4,0,.2,1)",
          }}
        />
      </div>

      {/* How to use a Bluetooth (HID-keyboard) caliper, eg iGaging Origin Cal */}
      <CaliperHelp unit={settings.measurement_unit} />

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

        {/* Anchored input popover over the active point.
            key={editingPoint.id} forces a fresh mount per point so autoFocus
            on the new <input> always fires. */}
        {editingPoint && editingChip && (
          <div
            key={editingPoint.id}
            role="dialog"
            aria-label={`Enter depth for point ${editingPoint.point_number}`}
            style={{
              position: "absolute",
              left: `${(editingChip.cx / RINK_W) * 100}%`,
              top: `${(editingChip.cy / RINK_H) * 100}%`,
              transform: `translate(-50%, ${
                popoverAbove ? "calc(-100% - 22px)" : "22px"
              })`,
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
            onMouseDown={(e) => {
              // Clicks inside the popover (eg the Skip/Save buttons) shouldn't
              // bubble up and re-trigger the chip click that opened us.
              e.stopPropagation()
            }}
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
                {editingPoint.point_number}
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
                {editingPoint.label ?? `Point ${editingPoint.point_number}`}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                autoFocus
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={draftValue}
                onChange={(e) => {
                  // Bluetooth HID calipers (eg iGaging IP54 100-700-B04) type
                  // the reading like a keyboard. Strip everything that isn't a
                  // digit or single decimal point so "+1.50" / "1,50" / etc.
                  // still land cleanly. Cap to 3 decimal places.
                  const raw = e.target.value
                  const digitsOnly = raw.replace(/[^0-9.]/g, "")
                  const firstDot = digitsOnly.indexOf(".")
                  const normalized =
                    firstDot < 0
                      ? digitsOnly
                      : digitsOnly.slice(0, firstDot + 1) +
                        digitsOnly.slice(firstDot + 1).replace(/\./g, "")
                  const trimmed =
                    firstDot < 0
                      ? normalized
                      : normalized.slice(0, firstDot + 1 + 3)
                  setDraftValue(trimmed)
                }}
                onKeyDown={(e) => {
                  // Treat the gauge's Tab terminator like Enter — both
                  // commonly available on HID calipers — so the measurement
                  // saves and advances to the next point either way.
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault()
                    handleEnter()
                  } else if (e.key === "Escape") {
                    e.preventDefault()
                    handleEscape()
                  }
                }}
                onBlur={handleBlur}
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
                {settings.measurement_unit}
              </span>
            </div>

            {liveSev && (
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
                {SEVERITY_LABEL[liveSev]}
              </div>
            )}

            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button
                type="button"
                // Prevent focus from leaving the input on press; otherwise the
                // input's onBlur fires first, clears editingIdx, and the onClick
                // below becomes a no-op.
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleSkip}
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
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleEnter}
                disabled={!hasInput}
                style={{
                  flex: 1,
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: 0,
                  background: hasInput
                    ? `linear-gradient(180deg, #7AFF40 0%, ${GREEN} 100%)`
                    : "var(--muted)",
                  color: hasInput ? "#051200" : "var(--muted-foreground)",
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  cursor: hasInput ? "pointer" : "not-allowed",
                }}
              >
                {isLastPoint ? "Save & Review" : "Save & Next"}
              </button>
            </div>
          </div>
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

// ── Bluetooth caliper help ────────────────────────────────────────────────────

// Bluetooth calipers in this class (eg iGaging Absolute Origin Smart) pair as a
// standard Bluetooth *keyboard* at the OS level — the web app can't and needn't
// initiate pairing. Once paired, pressing the caliper's DATA button types the
// reading followed by Enter into the focused field, which the point input
// already captures (its onChange sanitizes the keystrokes; Enter saves and
// advances). So this is a collapsible how-to rather than a pairing control, and
// it's available to every submitter — no management/admin gating.
function CaliperHelp({ unit }: { unit: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginBottom: 10 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          justifyContent: "center",
          minHeight: 40,
          padding: "0 14px",
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--muted)",
          color: "var(--foreground)",
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.02em",
          cursor: "pointer",
        }}
      >
        <Bluetooth size={16} aria-hidden />
        Using a Bluetooth caliper?
      </button>
      {open && (
        <div
          style={{
            marginTop: 8,
            padding: 12,
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--card)",
            fontSize: 12,
            lineHeight: 1.5,
            color: "var(--muted-foreground)",
          }}
        >
          <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
            <li>
              <strong style={{ color: "var(--foreground)" }}>Pair once</strong>{" "}
              in your phone/tablet&apos;s Bluetooth settings: hold the caliper&apos;s{" "}
              <strong>DATA</strong> button ~5s until it appears (it shows up as a
              keyboard), then tap to connect.
            </li>
            <li>
              <strong style={{ color: "var(--foreground)" }}>Capture</strong>: tap
              a point on the rink above, then press the caliper&apos;s{" "}
              <strong>DATA</strong> button — the depth fills in and jumps to the
              next point. Keep pressing to walk the whole rink hands-free.
            </li>
            <li>
              Set the caliper to the same unit as this form (
              <strong style={{ color: "var(--foreground)" }}>{unit}</strong>) so
              readings record correctly.
            </li>
          </ol>
        </div>
      )}
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
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  isOnline: boolean
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
  onSubmit,
  isOnline,
  stateError,
  onBack,
  baseId,
}: ReviewPhaseProps) {
  return (
    <form
      action={formAction}
      onSubmit={onSubmit}
      className="flex flex-col gap-4"
    >
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
        <SubmitButton
          filledCount={stats.total}
          total={sortedPoints.length}
          isOnline={isOnline}
        />
        {!isOnline && (
          <p
            style={{
              fontSize: 12,
              color: "var(--muted-foreground)",
              textAlign: "center",
            }}
          >
            You&apos;re offline. This session will be saved on your device and
            submitted automatically when you reconnect.
          </p>
        )}
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
  isOnline,
}: {
  filledCount: number
  total: number
  isOnline: boolean
}) {
  const { pending } = useFormStatus()
  const idleLabel = !isOnline
    ? "Save Offline"
    : filledCount === total
      ? "Submit Reading"
      : `Submit (${filledCount} of ${total} recorded)`
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
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
      {pending ? "Submitting…" : idleLabel}
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

// ── Offline "saved on this device" confirmation ───────────────────────────────

function QueuedConfirmation() {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 24,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        textAlign: "center",
      }}
    >
      <div
        aria-hidden
        style={{
          width: 56,
          height: 56,
          borderRadius: 9999,
          background: `${GREEN}22`,
          color: GREEN,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <div
        style={{
          fontFamily: DISPLAY_FONT,
          fontSize: 22,
          lineHeight: 1.1,
          letterSpacing: "0.01em",
          textTransform: "uppercase",
          color: "var(--foreground)",
        }}
      >
        Saved on this device
      </div>
      <p
        style={{
          fontSize: 13,
          color: "var(--muted-foreground)",
          maxWidth: 360,
        }}
      >
        You&apos;re offline, so this ice-depth session is queued and will submit
        automatically once you&apos;re back online — the same checks run then.
        You can keep working.
      </p>
    </div>
  )
}
