"use client"

// Admin editor for the facility-level rink-diagram overlays:
//   * Door markers — click-to-place (with a chosen door type), drag to move,
//     select to relabel/retype/delete. Door types themselves are managed in
//     the same tab (add / rename / recolor / reorder / deactivate / delete).
//   * Center-ice logo — upload, drag to reposition, sliders for scale /
//     rotation / opacity, visibility toggle, remove.
//
// These are facility configuration, shared by every diagram in the facility,
// so the preview renders the bare USA-Hockey rink (no measurement points).
// All writes go through the module-admin-gated server actions in
// ../overlay-actions.ts — the UI is NOT the authorization boundary.

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react"
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react"
import { toast } from "sonner"

import { RINK_H, RINK_W, RinkMarkings } from "@/components/ice-depth/usa-rink"
import {
  DoorMarkerGlyph,
  DoorMarkerLegend,
} from "@/components/ice-depth/rink-overlays"
import {
  DOOR_MARKER_DEFAULT_COLOR,
  logoBox,
  markerTitle,
  type RinkOverlayMarker,
} from "@/lib/ice-depth/overlay-shared"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

import {
  deleteDoorMarker,
  deleteDoorType,
  removeRinkLogo,
  seedDefaultDoorTypes,
  setDoorTypeActive,
  updateRinkLogoLayout,
  uploadRinkLogo,
  upsertDoorMarker,
  upsertDoorType,
} from "../overlay-actions"
import type {
  ActionState,
  DoorMarkerRow,
  DoorTypeRow,
  RinkDiagramConfigRow,
} from "../types"

const NULL_STATE: ActionState = { ok: null }

type EditorMode = "place" | "select" | "drag" | "logo"

type LogoLayoutState = {
  position_x: number
  position_y: number
  scale: number
  rotation: number
  opacity: number
  visible: boolean
}

function layoutFromConfig(config: RinkDiagramConfigRow | null): LogoLayoutState {
  return {
    position_x: config?.logo_position_x ?? 0.5,
    position_y: config?.logo_position_y ?? 0.5,
    scale: config?.logo_scale ?? 0.25,
    rotation: config?.logo_rotation ?? 0,
    opacity: config?.logo_opacity ?? 0.15,
    visible: config?.logo_visible ?? true,
  }
}

type Props = {
  doorTypes: DoorTypeRow[]
  markers: DoorMarkerRow[]
  config: RinkDiagramConfigRow | null
  logoUrl: string | null
}

export function OverlaysTab({ doorTypes, markers, config, logoUrl }: Props) {
  const [mode, setMode] = useState<EditorMode>("place")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const activeTypes = doorTypes.filter((t) => t.is_active)
  const [placeTypeId, setPlaceTypeId] = useState<string | null>(null)
  // Live preview state for the logo; committed to the server on release.
  const [logo, setLogo] = useState<LogoLayoutState>(() => layoutFromConfig(config))

  const effectivePlaceTypeId =
    placeTypeId && activeTypes.some((t) => t.id === placeTypeId)
      ? placeTypeId
      : (activeTypes[0]?.id ?? null)

  const typeById = new Map(doorTypes.map((t) => [t.id, t]))
  const selected = markers.find((m) => m.id === selectedId) ?? null

  const legendMarkers: RinkOverlayMarker[] = markers.flatMap((m) => {
    const t = typeById.get(m.door_type_id)
    if (!t || !t.is_active) return []
    return [
      {
        id: m.id,
        label: m.label,
        position_x: m.position_x,
        position_y: m.position_y,
        type_name: t.name,
        color: t.color ?? DOOR_MARKER_DEFAULT_COLOR,
      },
    ]
  })

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Diagram overlays</CardTitle>
            <p className="text-muted-foreground text-sm">
              Facility-wide reference geography — door markers and the
              center-ice logo appear on every ice-depth diagram, on every
              report.
            </p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ModeToolbar
            mode={mode}
            setMode={setMode}
            activeTypes={activeTypes}
            placeTypeId={effectivePlaceTypeId}
            setPlaceTypeId={setPlaceTypeId}
            hasLogo={Boolean(logoUrl)}
          />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="flex flex-col gap-2">
              <OverlayDiagram
                markers={markers}
                typeById={typeById}
                mode={mode}
                placeTypeId={effectivePlaceTypeId}
                selectedId={selectedId}
                onSelect={setSelectedId}
                logoUrl={logoUrl}
                logo={logo}
                setLogo={setLogo}
              />
              <DoorMarkerLegend markers={legendMarkers} />
            </div>
            <div className="flex flex-col gap-3">
              {selected ? (
                <SelectedMarkerEditor
                  key={selected.id}
                  marker={selected}
                  doorTypes={activeTypes}
                  onClear={() => setSelectedId(null)}
                />
              ) : (
                <LogoCard
                  config={config}
                  logoUrl={logoUrl}
                  logo={logo}
                  setLogo={setLogo}
                />
              )}
              <DoorTypesCard doorTypes={doorTypes} />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mode toolbar
// ---------------------------------------------------------------------------

function ModeToolbar({
  mode,
  setMode,
  activeTypes,
  placeTypeId,
  setPlaceTypeId,
  hasLogo,
}: {
  mode: EditorMode
  setMode: (m: EditorMode) => void
  activeTypes: DoorTypeRow[]
  placeTypeId: string | null
  setPlaceTypeId: (id: string) => void
  hasLogo: boolean
}) {
  const modes: ReadonlyArray<{ key: EditorMode; label: string; help: string }> = [
    { key: "place", label: "Place door", help: "Click the diagram to add a door marker." },
    { key: "select", label: "Select", help: "Click a marker to edit or delete it." },
    { key: "drag", label: "Drag", help: "Drag a marker to move it; release to save." },
    {
      key: "logo",
      label: "Move logo",
      help: hasLogo
        ? "Drag the logo to reposition it; release to save."
        : "Upload a logo first (right panel).",
    },
  ]
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="bg-muted/40 flex items-center gap-1 rounded-md border p-1">
        {modes.map((m) => {
          const disabled = m.key === "logo" && !hasLogo
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
      {mode === "place" && (
        <select
          aria-label="Door type to place"
          value={placeTypeId ?? ""}
          onChange={(e) => setPlaceTypeId(e.target.value)}
          className="border-input bg-background h-8 rounded-md border px-2 py-1 text-sm"
        >
          {activeTypes.length === 0 && (
            <option value="" disabled>
              No active door types…
            </option>
          )}
          {activeTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      <span className="text-muted-foreground text-xs">
        {modes.find((m) => m.key === mode)?.help}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Diagram panel
// ---------------------------------------------------------------------------

function OverlayDiagram({
  markers,
  typeById,
  mode,
  placeTypeId,
  selectedId,
  onSelect,
  logoUrl,
  logo,
  setLogo,
}: {
  markers: DoorMarkerRow[]
  typeById: Map<string, DoorTypeRow>
  mode: EditorMode
  placeTypeId: string | null
  selectedId: string | null
  onSelect: (id: string | null) => void
  logoUrl: string | null
  logo: LogoLayoutState
  setLogo: (l: LogoLayoutState) => void
}) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [placing, startPlacing] = useTransition()
  const [dragging, setDragging] = useState<string | null>(null)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const [logoDragging, setLogoDragging] = useState(false)

  // Same client-coords → 0..1 fraction mapping as the point layout editor;
  // the container matches the rink's aspect ratio so plain division is exact.
  const toFrac = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const svg = svgRef.current
      if (!svg) return null
      const rect = svg.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      return {
        x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
      }
    },
    [],
  )

  function onSvgClick(e: ReactMouseEvent<SVGSVGElement>) {
    if (mode !== "place") return
    if (!placeTypeId) {
      toast.error("Create/activate a door type first.")
      return
    }
    const target = e.target
    if (target instanceof Element && target.closest("[data-door-marker]")) {
      return
    }
    const frac = toFrac(e.clientX, e.clientY)
    if (!frac) return
    startPlacing(async () => {
      const r = await upsertDoorMarker({
        door_type_id: placeTypeId,
        position_x: frac.x,
        position_y: frac.y,
      })
      if (!r.ok) toast.error(r.error)
    })
  }

  function onMarkerPointerDown(
    e: ReactPointerEvent<SVGGElement>,
    marker: DoorMarkerRow,
  ) {
    if (mode === "select") {
      e.stopPropagation()
      onSelect(marker.id)
      return
    }
    if (mode === "drag") {
      e.stopPropagation()
      e.preventDefault()
      onSelect(marker.id)
      setDragging(marker.id)
      const frac = toFrac(e.clientX, e.clientY)
      if (frac) setDragPos(frac)
      try {
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
      } catch {
        /* ignore */
      }
    }
  }

  function onSvgPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (mode !== "logo" || !logoUrl) return
    e.preventDefault()
    setLogoDragging(true)
    const frac = toFrac(e.clientX, e.clientY)
    if (frac) setLogo({ ...logo, position_x: frac.x, position_y: frac.y })
  }

  function onSvgPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (mode === "drag" && dragging) {
      const frac = toFrac(e.clientX, e.clientY)
      if (frac) setDragPos(frac)
      return
    }
    if (mode === "logo" && logoDragging) {
      const frac = toFrac(e.clientX, e.clientY)
      if (frac) setLogo({ ...logo, position_x: frac.x, position_y: frac.y })
    }
  }

  function onSvgPointerUp() {
    if (mode === "drag" && dragging && dragPos) {
      const id = dragging
      const marker = markers.find((m) => m.id === id)
      const { x, y } = dragPos
      setDragging(null)
      setDragPos(null)
      if (marker) {
        void upsertDoorMarker({
          id,
          door_type_id: marker.door_type_id,
          label: marker.label,
          position_x: x,
          position_y: y,
        }).then((r) => {
          if (!r.ok) toast.error(r.error)
        })
      }
      return
    }
    setDragging(null)
    setDragPos(null)
    if (mode === "logo" && logoDragging) {
      setLogoDragging(false)
      void updateRinkLogoLayout({
        position_x: logo.position_x,
        position_y: logo.position_y,
      }).then((r) => {
        if (!r.ok) toast.error(r.error)
      })
    }
  }

  const cursor =
    mode === "place"
      ? "cursor-crosshair"
      : mode === "drag" || mode === "logo"
        ? "cursor-grab"
        : "cursor-pointer"

  const box = logoBox(logo, RINK_W, RINK_H)

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
          onPointerDown={onSvgPointerDown}
          onPointerMove={onSvgPointerMove}
          onPointerUp={onSvgPointerUp}
          onPointerLeave={onSvgPointerUp}
        >
          <g pointerEvents="none">
            <RinkMarkings />
            {/* Logo preview: bottom of the stack, live local layout. Hidden
                logos preview at reduced emphasis so re-enabling is easy. */}
            {logoUrl && (
              <image
                href={logoUrl}
                x={box.x}
                y={box.y}
                width={box.size}
                height={box.size}
                opacity={logo.visible ? logo.opacity : Math.min(logo.opacity, 0.06)}
                preserveAspectRatio="xMidYMid meet"
                transform={
                  logo.rotation
                    ? `rotate(${logo.rotation} ${box.cx} ${box.cy})`
                    : undefined
                }
              />
            )}
            {mode === "logo" && logoUrl && (
              <rect
                x={box.x}
                y={box.y}
                width={box.size}
                height={box.size}
                fill="none"
                stroke="#4DFF00"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                transform={
                  logo.rotation
                    ? `rotate(${logo.rotation} ${box.cx} ${box.cy})`
                    : undefined
                }
              />
            )}
          </g>

          {/* Door markers */}
          {markers.map((m) => {
            const t = typeById.get(m.door_type_id)
            const isDragging = dragging === m.id
            const x = isDragging && dragPos ? dragPos.x : m.position_x
            const y = isDragging && dragPos ? dragPos.y : m.position_y
            const inactiveType = !t || !t.is_active
            return (
              <g
                key={m.id}
                data-door-marker="1"
                onPointerDown={(e) => onMarkerPointerDown(e, m)}
                style={{ cursor: mode === "drag" ? "grab" : "pointer" }}
                opacity={inactiveType ? 0.35 : 1}
              >
                <DoorMarkerGlyph
                  cx={x * RINK_W}
                  cy={y * RINK_H}
                  color={t?.color ?? DOOR_MARKER_DEFAULT_COLOR}
                  title={markerTitle({
                    type_name: t?.name ?? "Inactive type",
                    label: m.label,
                  })}
                  selected={selectedId === m.id}
                />
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
      {markers.length === 0 && (
        <p className="text-muted-foreground text-sm">
          Pick a door type and click the diagram to place your first marker.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Selected-marker editor
// ---------------------------------------------------------------------------

function SelectedMarkerEditor({
  marker,
  doorTypes,
  onClear,
}: {
  marker: DoorMarkerRow
  doorTypes: DoorTypeRow[]
  onClear: () => void
}) {
  const [label, setLabel] = useState(marker.label ?? "")
  const [typeId, setTypeId] = useState(marker.door_type_id)
  const [savePending, startSave] = useTransition()
  const [delPending, startDel] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)

  function onSave() {
    startSave(async () => {
      const r = await upsertDoorMarker({
        id: marker.id,
        door_type_id: typeId,
        label,
        position_x: marker.position_x,
        position_y: marker.position_y,
      })
      if (!r.ok) toast.error(r.error)
      else toast.success("Marker saved.")
    })
  }

  function onConfirmDelete() {
    setConfirmOpen(false)
    startDel(async () => {
      const r = await deleteDoorMarker(marker.id)
      if (!r.ok) toast.error(r.error)
      else {
        toast.success("Marker deleted.")
        onClear()
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Door marker</CardTitle>
          <Button variant="ghost" size="sm" onClick={onClear}>
            Close
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="dm-type">Door type</Label>
          <select
            id="dm-type"
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
            className="border-input bg-background h-9 rounded-md border px-2 py-1 text-sm"
          >
            {doorTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="dm-label">Label (optional)</Label>
          <Input
            id="dm-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. West Zamboni"
          />
        </div>
        <p className="text-muted-foreground font-mono text-xs">
          x {marker.position_x.toFixed(3)} · y {marker.position_y.toFixed(3)}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onSave} disabled={savePending}>
            {savePending ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setConfirmOpen(true)}
            disabled={delPending}
          >
            Delete
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this door marker?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The marker will no longer appear on any
              ice-depth report.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Logo card (upload + layout controls)
// ---------------------------------------------------------------------------

function LogoCard({
  config,
  logoUrl,
  logo,
  setLogo,
}: {
  config: RinkDiagramConfigRow | null
  logoUrl: string | null
  logo: LogoLayoutState
  setLogo: (l: LogoLayoutState) => void
}) {
  const [uploadState, uploadAction, uploadPending] = useActionState(
    uploadRinkLogo,
    NULL_STATE,
  )
  const [layoutPending, startLayout] = useTransition()
  const [removePending, startRemove] = useTransition()

  useEffect(() => {
    if (uploadState.ok === true) toast.success(uploadState.message ?? "Logo uploaded.")
    if (uploadState.ok === false) toast.error(uploadState.error)
  }, [uploadState])

  function commitLayout(patch: Partial<LogoLayoutState>) {
    startLayout(async () => {
      const r = await updateRinkLogoLayout(patch)
      if (!r.ok) toast.error(r.error)
    })
  }

  function onToggleVisible() {
    const visible = !logo.visible
    setLogo({ ...logo, visible })
    commitLayout({ visible })
  }

  function onRemove() {
    if (!confirm("Remove the center-ice logo?")) return
    startRemove(async () => {
      const r = await removeRinkLogo()
      if (!r.ok) toast.error(r.error)
      else toast.success("Logo removed.")
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Center-ice logo</CardTitle>
          {config?.logo_storage_path && !logo.visible && (
            <Badge variant="secondary" className="uppercase">
              hidden
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form action={uploadAction} className="flex flex-col gap-2">
          <Label htmlFor="logo-file">
            {logoUrl ? "Replace logo" : "Upload logo"}
          </Label>
          <Input
            id="logo-file"
            name="file"
            type="file"
            accept=".png,.svg,.webp,image/png,image/svg+xml,image/webp"
            required
          />
          <p className="text-muted-foreground text-xs">
            PNG, SVG, or WebP with a transparent background. Max 2 MB. Rendered
            as a low-opacity watermark under the measurement points.
          </p>
          <div>
            <Button type="submit" size="sm" disabled={uploadPending}>
              {uploadPending ? "Uploading…" : "Upload"}
            </Button>
          </div>
        </form>

        {logoUrl && (
          <div className="flex flex-col gap-3 border-t pt-3">
            <LogoSlider
              id="logo-scale"
              label="Size"
              min={0.05}
              max={1}
              step={0.01}
              value={logo.scale}
              format={(v) => `${Math.round(v * 100)}% of width`}
              onChange={(scale) => setLogo({ ...logo, scale })}
              onCommit={(scale) => commitLayout({ scale })}
            />
            <LogoSlider
              id="logo-rotation"
              label="Rotation"
              min={-180}
              max={180}
              step={1}
              value={logo.rotation}
              format={(v) => `${Math.round(v)}°`}
              onChange={(rotation) => setLogo({ ...logo, rotation })}
              onCommit={(rotation) => commitLayout({ rotation })}
            />
            <LogoSlider
              id="logo-opacity"
              label="Opacity"
              min={0.02}
              max={1}
              step={0.01}
              value={logo.opacity}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(opacity) => setLogo({ ...logo, opacity })}
              onCommit={(opacity) => commitLayout({ opacity })}
            />
            <p className="text-muted-foreground font-mono text-xs">
              x {logo.position_x.toFixed(3)} · y {logo.position_y.toFixed(3)} —
              use “Move logo” mode to drag it on the diagram.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={onToggleVisible}
                disabled={layoutPending}
              >
                {logo.visible ? "Hide on reports" : "Show on reports"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={onRemove}
                disabled={removePending}
              >
                Remove logo
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function LogoSlider({
  id,
  label,
  min,
  max,
  step,
  value,
  format,
  onChange,
  onCommit,
}: {
  id: string
  label: string
  min: number
  max: number
  step: number
  value: number
  format: (v: number) => string
  onChange: (v: number) => void
  onCommit: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        <span className="text-muted-foreground font-mono text-xs">
          {format(value)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={() => onCommit(value)}
        onKeyUp={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") onCommit(value)
        }}
        className="accent-primary w-full"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Door-types manager
// ---------------------------------------------------------------------------

function DoorTypesCard({ doorTypes }: { doorTypes: DoorTypeRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [seedPending, startSeed] = useTransition()

  function onSeed() {
    startSeed(async () => {
      const r = await seedDefaultDoorTypes()
      if (!r.ok) toast.error(r.error)
      else toast.success("Standard door types seeded.")
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Door types</CardTitle>
          {doorTypes.length === 0 && (
            <Button size="sm" variant="outline" onClick={onSeed} disabled={seedPending}>
              {seedPending ? "Seeding…" : "Seed standard types"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <ul className="flex flex-col gap-1">
          {doorTypes.map((t) => (
            <DoorTypeRowItem
              key={t.id}
              doorType={t}
              editing={editingId === t.id}
              onToggleEdit={() =>
                setEditingId((cur) => (cur === t.id ? null : t.id))
              }
            />
          ))}
        </ul>
        <DoorTypeForm onDone={() => setEditingId(null)} />
      </CardContent>
    </Card>
  )
}

function DoorTypeRowItem({
  doorType,
  editing,
  onToggleEdit,
}: {
  doorType: DoorTypeRow
  editing: boolean
  onToggleEdit: () => void
}) {
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)

  function onToggleActive() {
    startActive(async () => {
      const r = await setDoorTypeActive(doorType.id, !doorType.is_active)
      if (!r.ok) toast.error(r.error)
    })
  }

  function onConfirmDelete() {
    setConfirmOpen(false)
    startDel(async () => {
      const r = await deleteDoorType(doorType.id)
      if (!r.ok) toast.error(r.error)
    })
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border px-3 py-2">
      <div className="flex items-center gap-2">
        <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true">
          <path
            d="M 8 1 L 15 8 L 8 15 L 1 8 Z"
            fill={doorType.color ?? DOOR_MARKER_DEFAULT_COLOR}
            stroke="#ffffff"
            strokeWidth={1.5}
          />
        </svg>
        <span
          className={cn(
            "flex-1 truncate text-sm",
            !doorType.is_active && "text-muted-foreground line-through",
          )}
        >
          {doorType.name}
        </span>
        <Button variant="ghost" size="sm" onClick={onToggleEdit}>
          {editing ? "Cancel" : "Edit"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleActive}
          disabled={activePending}
        >
          {doorType.is_active ? "Deactivate" : "Activate"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={() => setConfirmOpen(true)}
          disabled={delPending}
        >
          Delete
        </Button>
      </div>
      {editing && <DoorTypeForm doorType={doorType} onDone={onToggleEdit} />}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete door type &ldquo;{doorType.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              Markers using this type must be deleted first, or deactivate the
              type instead. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}

function DoorTypeForm({
  doorType,
  onDone,
}: {
  doorType?: DoorTypeRow
  onDone: () => void
}) {
  const [state, action, pending] = useActionState(upsertDoorType, NULL_STATE)

  useEffect(() => {
    if (state.ok === true) {
      toast.success(state.message ?? "Saved.")
      onDone()
    }
    if (state.ok === false) toast.error(state.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire on action result only
  }, [state])

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      {doorType && <input type="hidden" name="id" value={doorType.id} />}
      <div className="flex min-w-36 flex-1 flex-col gap-1">
        <Label htmlFor={doorType ? `dt-name-${doorType.id}` : "dt-name-new"}>
          {doorType ? "Name" : "New door type"}
        </Label>
        <Input
          id={doorType ? `dt-name-${doorType.id}` : "dt-name-new"}
          name="name"
          defaultValue={doorType?.name ?? ""}
          placeholder="e.g. Referee Door"
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={doorType ? `dt-color-${doorType.id}` : "dt-color-new"}>
          Color
        </Label>
        <input
          id={doorType ? `dt-color-${doorType.id}` : "dt-color-new"}
          name="color"
          type="color"
          defaultValue={doorType?.color ?? DOOR_MARKER_DEFAULT_COLOR}
          className="border-input bg-background h-9 w-12 rounded-md border p-1"
        />
      </div>
      <div className="flex w-20 flex-col gap-1">
        <Label htmlFor={doorType ? `dt-sort-${doorType.id}` : "dt-sort-new"}>
          Order
        </Label>
        <Input
          id={doorType ? `dt-sort-${doorType.id}` : "dt-sort-new"}
          name="sort_order"
          type="number"
          defaultValue={doorType?.sort_order ?? 0}
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : doorType ? "Save" : "Add"}
      </Button>
    </form>
  )
}
