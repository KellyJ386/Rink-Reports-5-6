"use client"

import Link from "next/link"
import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react"
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react"
import { toast } from "sonner"

import { RINK_W, RINK_H } from "@/components/ice-depth/usa-rink"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import {
  createPoint,
  deleteLayout,
  deletePoint,
  movePoint,
  renumberPointsForLayout,
  setLayoutActive,
  updateLayout,
  updatePoint,
} from "../actions"
import type { ActionState, LayoutDetail, PointRow } from "../types"

const NULL_STATE: ActionState = { ok: null }
const POINT_CAP = 60

type EditorMode = "place" | "select" | "drag"

type Props = {
  detail: LayoutDetail
  backHref: string
}

export function LayoutEditor({ detail, backHref }: Props) {
  const { layout, points } = detail

  const [modeRaw, setMode] = useState<EditorMode>("place")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const activeCount = useMemo(
    () => points.filter((p) => p.is_active).length,
    [points],
  )
  const placeDisabled = activeCount >= POINT_CAP
  // Force "select" if cap reached — no effect needed; derive at render time.
  const mode: EditorMode =
    modeRaw === "place" && placeDisabled ? "select" : modeRaw

  const selected = useMemo(
    () => points.find((p) => p.id === selectedId) ?? null,
    [points, selectedId],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={backHref}>← Back to layouts</Link>
        </Button>
      </div>

      <LayoutHeaderCard layout={layout} />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Point editor</CardTitle>
            <div className="text-muted-foreground text-sm">
              <span
                className={cn(
                  "font-medium",
                  activeCount >= POINT_CAP
                    ? "text-destructive"
                    : "text-foreground",
                )}
              >
                {activeCount}
              </span>{" "}
              / {POINT_CAP} active points
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ModeToolbar
            mode={mode}
            setMode={setMode}
            placeDisabled={placeDisabled}
            layoutId={layout.id}
          />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <DiagramPanel
              layoutId={layout.id}
              aspectRatio={layout.diagram_aspect_ratio}
              points={points}
              mode={mode}
              placeDisabled={placeDisabled}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
            <SidePanel
              points={points}
              selected={selected}
              onSelect={setSelectedId}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header (rename, slug, aspect, is_active, delete)
// ---------------------------------------------------------------------------

function LayoutHeaderCard({ layout }: { layout: LayoutDetail["layout"] }) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState(updateLayout, NULL_STATE)
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Layout updated.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  function onToggleActive() {
    startActive(async () => {
      const r = await setLayoutActive(layout.id, !layout.is_active)
      if (!r.ok) toast.error(r.error)
    })
  }
  function onDelete() {
    if (
      !confirm(
        "Delete this layout? This cascades all points. If sessions reference it, deactivate instead.",
      )
    ) {
      return
    }
    startDel(async () => {
      const r = await deleteLayout(layout.id)
      if (!r.ok) toast.error(r.error)
      else {
        toast.success("Layout deleted.")
        window.location.href = "/admin/ice-depth?tab=layouts"
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            {layout.name}
            {!layout.is_active && (
              <span className="bg-muted rounded-full px-2 py-0.5 text-xs font-medium uppercase">
                inactive
              </span>
            )}
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? "Cancel" : "Rename"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleActive}
              disabled={activePending}
            >
              {layout.is_active ? "Deactivate" : "Activate"}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={onDelete}
              disabled={delPending}
            >
              Delete layout
            </Button>
          </div>
        </div>
      </CardHeader>
      {editing && (
        <CardContent>
          <form
            action={action}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <input type="hidden" name="id" value={layout.id} />
            <div className="flex flex-col gap-1">
              <Label htmlFor="ld-name">Name</Label>
              <Input
                id="ld-name"
                name="name"
                defaultValue={layout.name}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ld-slug">Slug</Label>
              <Input id="ld-slug" name="slug" defaultValue={layout.slug} />
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <Label htmlFor="ld-desc">Description</Label>
              <Textarea
                id="ld-desc"
                name="description"
                rows={2}
                defaultValue={layout.description ?? ""}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ld-aspect">
                Aspect ratio (width / height)
              </Label>
              <Input
                id="ld-aspect"
                name="diagram_aspect_ratio"
                type="number"
                step="0.001"
                min="0.05"
                max="10"
                defaultValue={layout.diagram_aspect_ratio}
              />
              <p className="text-muted-foreground text-xs">
                Default 0.425 ≈ 85×200 NHL rink (vertical).
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ld-sort">Sort order</Label>
              <Input
                id="ld-sort"
                name="sort_order"
                type="number"
                defaultValue={layout.sort_order}
                className="w-32"
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Saving…" : "Save layout"}
              </Button>
            </div>
          </form>
        </CardContent>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Mode toolbar
// ---------------------------------------------------------------------------

function ModeToolbar({
  mode,
  setMode,
  placeDisabled,
  layoutId,
}: {
  mode: EditorMode
  setMode: (m: EditorMode) => void
  placeDisabled: boolean
  layoutId: string
}) {
  const [renumPending, startRenum] = useTransition()

  function onRenumber() {
    if (
      !confirm(
        "Compact point numbers for this layout? Active points will be renumbered 1..N in current sort order.",
      )
    )
      return
    startRenum(async () => {
      const r = await renumberPointsForLayout(layoutId)
      if (!r.ok) toast.error(r.error)
      else toast.success("Points renumbered.")
    })
  }

  const modes: ReadonlyArray<{ key: EditorMode; label: string; help: string }> =
    [
      {
        key: "place",
        label: "Place",
        help: "Click the diagram to add a new point.",
      },
      {
        key: "select",
        label: "Select",
        help: "Click a point to edit, reorder, or delete it.",
      },
      {
        key: "drag",
        label: "Drag",
        help: "Drag a point to move it; release to save.",
      },
    ]

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="bg-muted/40 flex items-center gap-1 rounded-md border p-1">
          {modes.map((m) => {
            const disabled = m.key === "place" && placeDisabled
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setMode(m.key)}
                disabled={disabled}
                className={cn(
                  "rounded px-3 py-1 text-sm font-medium transition-colors",
                  mode === m.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  disabled && "cursor-not-allowed opacity-50",
                )}
              >
                {m.label}
              </button>
            )
          })}
        </div>
        <span className="text-muted-foreground text-xs">
          {modes.find((m) => m.key === mode)?.help}
        </span>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRenumber}
        disabled={renumPending}
      >
        {renumPending ? "Renumbering…" : "Renumber 1..N"}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SVG diagram panel — USA Hockey rink
// ---------------------------------------------------------------------------

function DiagramPanel({
  layoutId,
  aspectRatio: _aspectRatio,
  points,
  mode,
  placeDisabled,
  selectedId,
  onSelect,
}: {
  layoutId: string
  aspectRatio: number
  points: PointRow[]
  mode: EditorMode
  placeDisabled: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [placing, startPlacing] = useTransition()
  const [dragging, setDragging] = useState<string | null>(null)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // toFrac maps client coords → 0..1 fractions stored as x_position/y_position.
  // The SVG container matches the rink's natural aspect ratio (380:740), so no
  // letterboxing occurs and this simple division is accurate.
  const toFrac = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const svg = svgRef.current
      if (!svg) return null
      const rect = svg.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      const x = (clientX - rect.left) / rect.width
      const y = (clientY - rect.top) / rect.height
      return {
        x: Math.min(1, Math.max(0, x)),
        y: Math.min(1, Math.max(0, y)),
      }
    },
    [],
  )

  function onSvgClick(e: ReactMouseEvent<SVGSVGElement>) {
    if (mode !== "place") return
    if (placeDisabled) {
      toast.error("Maximum 60 active points reached.")
      return
    }
    // Rink markings have pointerEvents="none" so only the overlay rect and
    // the SVG root itself can trigger this handler in place mode. Clicks
    // bubbling up from a point chip (or any of its descendants) must be
    // ignored so they don't create a new point on top of an existing one.
    const target = e.target
    if (target instanceof Element && target.closest("[data-point-chip]")) {
      return
    }
    // the SVG root itself can trigger this handler in place mode.
    const target = e.target as SVGElement
    if (target.closest("[data-point-chip]")) return
    const frac = toFrac(e.clientX, e.clientY)
    if (!frac) return
    startPlacing(async () => {
      const r = await createPoint(layoutId, frac.x, frac.y)
      if (!r.ok) toast.error(r.error)
    })
  }

  function onPointPointerDown(
    e: ReactPointerEvent<SVGGElement>,
    point: PointRow,
  ) {
    if (mode === "select") {
      e.stopPropagation()
      onSelect(point.id)
      return
    }
    if (mode === "drag" && point.is_active) {
      e.stopPropagation()
      e.preventDefault()
      onSelect(point.id)
      setDragging(point.id)
      const frac = toFrac(e.clientX, e.clientY)
      if (frac) setDragPos(frac)
      try {
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
      } catch {
        /* ignore */
      }
    }
  }

  function onSvgPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (mode !== "drag" || !dragging) return
    const frac = toFrac(e.clientX, e.clientY)
    if (!frac) return
    setDragPos(frac)
  }

  function onSvgPointerUp() {
    if (mode !== "drag" || !dragging || !dragPos) {
      setDragging(null)
      setDragPos(null)
      return
    }
    const id = dragging
    const x = dragPos.x
    const y = dragPos.y
    setDragging(null)
    setDragPos(null)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const r = await updatePoint(id, { x, y })
      if (!r.ok) toast.error(r.error)
    }, 100)
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const cursor =
    mode === "place"
      ? placeDisabled
        ? "cursor-not-allowed"
        : "cursor-crosshair"
      : mode === "drag"
        ? "cursor-grab"
        : "cursor-pointer"

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="bg-background relative w-full max-w-sm rounded-md border p-2"
        style={{ aspectRatio: `${RINK_W}/${RINK_H}` }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${RINK_W} ${RINK_H}`}
          preserveAspectRatio="xMidYMid meet"
          className={cn("h-full w-full select-none", cursor)}
          onClick={onSvgClick}
          onPointerMove={onSvgPointerMove}
          onPointerUp={onSvgPointerUp}
          onPointerLeave={onSvgPointerUp}
        >
          {/* USA Hockey rink markings — pointer-events off so clicks pass
              through to the SVG root for place mode */}
          <g pointerEvents="none">
            <defs>
              <pattern
                id="rr-editor-net"
                x="0"
                y="0"
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
              >
                <path d="M 0 0 L 6 6 M 6 0 L 0 6" stroke="#999" strokeWidth="0.5" fill="none" />
              </pattern>
            </defs>
            <rect x="62.5" y="70" width="255" height="600" rx="84" ry="84" fill="#e8f4f8" stroke="#333" strokeWidth="2" />
            <line x1="62.5" y1="370" x2="317.5" y2="370" stroke="#cc0000" strokeWidth="3" strokeDasharray="8 8" />
            <line x1="62.5" y1="262" x2="317.5" y2="262" stroke="#0044aa" strokeWidth="3" />
            <line x1="62.5" y1="478" x2="317.5" y2="478" stroke="#0044aa" strokeWidth="3" />
            <line x1="80" y1="103" x2="300" y2="103" stroke="#cc0000" strokeWidth="1.5" />
            <line x1="80" y1="637" x2="300" y2="637" stroke="#cc0000" strokeWidth="1.5" />
            <rect x="181" y="93" width="18" height="10" fill="url(#rr-editor-net)" stroke="#cc0000" strokeWidth="1.5" />
            <rect x="181" y="637" width="18" height="10" fill="url(#rr-editor-net)" stroke="#cc0000" strokeWidth="1.5" />
            <path d="M 172 103 A 18 18 0 0 1 208 103" fill="#add8e6" stroke="#cc0000" strokeWidth="1.5" />
            <path d="M 172 637 A 18 18 0 0 0 208 637" fill="#add8e6" stroke="#cc0000" strokeWidth="1.5" />
            <circle cx="190" cy="370" r="4" fill="#0044aa" />
            <circle cx="190" cy="370" r="45" fill="none" stroke="#0044aa" strokeWidth="1.5" />
            {([[124, 163], [256, 163], [124, 577], [256, 577]] as [number,number][]).map(([fx, fy], i) => (
              <g key={i}>
                <circle cx={fx} cy={fy} r="4" fill="#cc0000" />
                <circle cx={fx} cy={fy} r="45" fill="none" stroke="#cc0000" strokeWidth="1.5" />
              </g>
            ))}
          </g>

          {/* Point chips */}
          {points.map((p) => {
            const isDragging = dragging === p.id
            const x = isDragging && dragPos ? dragPos.x : p.x_position
            const y = isDragging && dragPos ? dragPos.y : p.y_position
            const cx = x * RINK_W
            const cy = y * RINK_H
            const isSelected = selectedId === p.id
            const r = 14
            return (
              <g
                key={p.id}
                data-point-chip="1"
                onPointerDown={(e) => onPointPointerDown(e, p)}
                style={{ cursor: mode === "drag" ? "grab" : "pointer" }}
              >
                {isSelected && (
                  <circle cx={cx} cy={cy} r={r + 6} fill="rgba(105,190,40,0.25)" stroke="#69BE28" strokeWidth="1.5" />
                )}
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill={isSelected ? "#002244" : p.is_active ? "#334155" : "#94a3b8"}
                  stroke={isSelected ? "#69BE28" : "#ffffff"}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  opacity={p.is_active ? 1 : 0.5}
                />
                <text
                  x={cx}
                  y={cy + 4}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={700}
                  fill="#ffffff"
                  pointerEvents="none"
                  style={{ userSelect: "none" }}
                >
                  {p.point_number}
                </text>
              </g>
            )
          })}
        </svg>
        {placing && (
          <div className="text-muted-foreground bg-background/80 absolute right-2 top-2 rounded-md border px-2 py-1 text-xs">
            Placing…
          </div>
        )}
      </div>
      {points.length === 0 && (
        <p className="text-muted-foreground text-sm">
          Click in the diagram to place your first point.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Side panel (selected point + numbered list)
// ---------------------------------------------------------------------------

function SidePanel({
  points,
  selected,
  onSelect,
}: {
  points: PointRow[]
  selected: PointRow | null
  onSelect: (id: string | null) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {selected ? (
        <SelectedPointEditor
          key={selected.id}
          point={selected}
          onClear={() => onSelect(null)}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No point selected</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Switch to Select mode and click a point to edit it.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Points</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 p-2">
          {points.length === 0 ? (
            <p className="text-muted-foreground p-2 text-sm">No points yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {[...points]
                .sort(
                  (a, b) =>
                    Number(b.is_active) - Number(a.is_active) ||
                    a.point_number - b.point_number,
                )
                .map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(p.id)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                        selected?.id === p.id
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      <span className="font-mono text-xs">
                        #{p.point_number}
                      </span>
                      <span className="ml-2 flex-1 truncate">
                        {p.label ?? <em className="opacity-70">no label</em>}
                      </span>
                      {!p.is_active && (
                        <span
                          className={cn(
                            "ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase",
                            selected?.id === p.id
                              ? "bg-primary-foreground/20"
                              : "bg-muted",
                          )}
                        >
                          off
                        </span>
                      )}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function SelectedPointEditor({
  point,
  onClear,
}: {
  point: PointRow
  onClear: () => void
}) {
  // The parent re-keys this component by point.id, so initial state is fine.
  // After a server action that updates label/coords, the parent fetches fresh
  // data and the component re-mounts (key collision with same id is OK because
  // the saved values match local state).
  const [label, setLabel] = useState<string>(point.label ?? "")
  const [x, setX] = useState<string>(point.x_position.toFixed(4))
  const [y, setY] = useState<string>(point.y_position.toFixed(4))
  const [savePending, startSave] = useTransition()
  const [movePending, startMove] = useTransition()
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()

  function onSave() {
    const xn = Number(x)
    const yn = Number(y)
    if (!Number.isFinite(xn) || xn < 0 || xn > 1) {
      toast.error("X must be between 0 and 1.")
      return
    }
    if (!Number.isFinite(yn) || yn < 0 || yn > 1) {
      toast.error("Y must be between 0 and 1.")
      return
    }
    startSave(async () => {
      const r = await updatePoint(point.id, { label, x: xn, y: yn })
      if (!r.ok) toast.error(r.error)
      else toast.success("Point saved.")
    })
  }

  function onMove(dir: -1 | 1) {
    startMove(async () => {
      const r = await movePoint(point.id, dir)
      if (!r.ok) toast.error(r.error)
    })
  }

  function onToggleActive() {
    startActive(async () => {
      const r = await updatePoint(point.id, { is_active: !point.is_active })
      if (!r.ok) toast.error(r.error)
    })
  }

  function onDelete() {
    if (
      !confirm(
        `Delete point #${point.point_number}? Existing measurements will keep their snapshots.`,
      )
    )
      return
    startDel(async () => {
      const r = await deletePoint(point.id)
      if (!r.ok) toast.error(r.error)
      else {
        toast.success("Point deleted.")
        onClear()
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">
            Point #{point.point_number}
            {!point.is_active && (
              <span className="bg-muted ml-2 rounded-full px-2 py-0.5 text-xs font-medium uppercase">
                off
              </span>
            )}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClear}>
            Close
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="pe-label">Label</Label>
          <Input
            id="pe-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Center ice"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="pe-x">X (0–1)</Label>
            <Input
              id="pe-x"
              type="number"
              step="0.001"
              min="0"
              max="1"
              value={x}
              onChange={(e) => setX(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pe-y">Y (0–1)</Label>
            <Input
              id="pe-y"
              type="number"
              step="0.001"
              min="0"
              max="1"
              value={y}
              onChange={(e) => setY(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onSave} disabled={savePending}>
            {savePending ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onMove(-1)}
            disabled={movePending}
          >
            ↑ Move up
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onMove(1)}
            disabled={movePending}
          >
            ↓ Move down
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onToggleActive}
            disabled={activePending}
          >
            {point.is_active ? "Deactivate" : "Activate"}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={onDelete}
            disabled={delPending}
          >
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
