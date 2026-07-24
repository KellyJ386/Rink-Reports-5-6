"use client"

// Admin editor for the facility-level rink-diagram overlays:
//   * Door markers — placed by picking a NUMBERED PERIMETER SECTION, the same
//     interaction as the Dasher Boards diagram: the board line is divided into
//     24 equal sections walked clockwise from the top-edge midpoint
//     (section 1). Click a section to place the chosen door type there;
//     select a door to relabel / retype / move it to another section /
//     delete. Door types themselves are managed in the same tab.
//   * Center-ice logo — upload, drag to reposition, sliders for scale /
//     rotation / opacity, visibility toggle, remove.
//
// Markers are STORED as ordinary normalized 0..1 coordinates (the section
// midpoint), so the DB schema, report rendering, and PDF are untouched;
// markers placed before the section UI existed display as their nearest
// section. All writes go through the module-admin-gated server actions in
// ../overlay-actions.ts — the UI is NOT the authorization boundary.

import {
  useActionState,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react"
import type { PointerEvent as ReactPointerEvent } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { RINK_H, RINK_W, RinkMarkings } from "@/components/ice-depth/usa-rink"
import {
  DoorMarkerGlyph,
  DoorMarkerLegend,
} from "@/components/ice-depth/rink-overlays"
import {
  DOOR_MARKER_DEFAULT_COLOR,
  DOOR_SECTION_COUNT,
  doorSections,
  logoBox,
  markerTitle,
  nearestDoorSection,
  sectionLabelAnchor,
  sectionPathD,
  sectionPosition,
  type DoorSection,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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

type EditorMode = "place" | "select" | "logo"

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

type RinkOption = {
  id: string
  name: string
  is_active: boolean
  is_default: boolean
}

type Props = {
  rinks: RinkOption[]
  selectedRinkId: string
  doorTypes: DoorTypeRow[]
  markers: DoorMarkerRow[]
  config: RinkDiagramConfigRow | null
  logoUrl: string | null
}

export function OverlaysTab({
  rinks,
  selectedRinkId,
  doorTypes,
  markers,
  config,
  logoUrl,
}: Props) {
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
            <div>
              <CardTitle>Diagram overlays</CardTitle>
              <p className="text-muted-foreground text-sm">
                Door markers and the center-ice logo belong to this rink —
                each sheet of ice keeps its own door layout. Saved here, they
                show up on every ice-depth report on this rink.
              </p>
            </div>
            {rinks.length > 1 && (
              <RinkSwitcher rinks={rinks} selectedRinkId={selectedRinkId} />
            )}
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
              <SectionDiagram
                rinkId={selectedRinkId}
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
                  rinkId={selectedRinkId}
                  marker={selected}
                  doorTypes={activeTypes}
                  onClear={() => setSelectedId(null)}
                />
              ) : (
                <LogoCard
                  rinkId={selectedRinkId}
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
// Rink switcher — navigates ?tab=overlays&rink=<id>, same pattern as the
// staff module's DiagramNav. Each rink keeps independent door markers + logo.
// ---------------------------------------------------------------------------

function RinkSwitcher({
  rinks,
  selectedRinkId,
}: {
  rinks: RinkOption[]
  selectedRinkId: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function onChange(rinkId: string) {
    startTransition(() => {
      const sp = new URLSearchParams()
      sp.set("tab", "overlays")
      sp.set("rink", rinkId)
      router.push(`/admin/ice-depth?${sp.toString()}`)
    })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="overlay-rink-select" className="text-muted-foreground text-xs">
        Rink
      </Label>
      <Select disabled={pending} value={selectedRinkId} onValueChange={onChange}>
        <SelectTrigger id="overlay-rink-select" className="h-9 w-48 text-sm">
          <SelectValue placeholder="Pick a rink…" />
        </SelectTrigger>
        <SelectContent>
          {rinks.map((r) => (
            <SelectItem key={r.id} value={r.id} className="text-sm">
              {r.name}
              {!r.is_active ? " (inactive)" : r.is_default ? " (default)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
    {
      key: "place",
      label: "Place door",
      help: "Tap a numbered section on the boards to place a door there.",
    },
    {
      key: "select",
      label: "Select",
      help: "Tap a door to edit it — or tap another section to move the selected door.",
    },
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
// Section diagram — numbered perimeter ring (dasher-boards interaction)
// ---------------------------------------------------------------------------

const SECTION_IDLE_COLOR = "#8A92A0"

function SectionDiagram({
  rinkId,
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
  rinkId: string
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
  const [placing, startPlacing] = useTransition()
  const [logoDragging, setLogoDragging] = useState(false)

  const sections = useMemo(() => doorSections(), [])

  // Section number → markers currently displayed there (nearest-section
  // bucketing, so legacy free-placed markers land in a section too).
  const markersBySection = useMemo(() => {
    const map = new Map<number, DoorMarkerRow[]>()
    for (const m of markers) {
      const n = nearestDoorSection(m.position_x, m.position_y)
      const list = map.get(n) ?? []
      list.push(m)
      map.set(n, list)
    }
    return map
  }, [markers])

  function placeInSection(section: DoorSection) {
    if (!placeTypeId) {
      toast.error("Create/activate a door type first.")
      return
    }
    const occupants = markersBySection.get(section.number) ?? []
    if (occupants.length > 0) {
      // A section holds one door — select the existing one instead of
      // stacking a second glyph on the same spot.
      onSelect(occupants[0].id)
      toast.info(
        `Section ${section.number} already has a door — edit it, or pick another section.`,
      )
      return
    }
    const pos = sectionPosition(section.number)
    startPlacing(async () => {
      const r = await upsertDoorMarker({
        rink_id: rinkId,
        door_type_id: placeTypeId,
        position_x: pos.position_x,
        position_y: pos.position_y,
      })
      if (!r.ok) toast.error(r.error)
    })
  }

  function moveSelectedToSection(section: DoorSection, marker: DoorMarkerRow) {
    const pos = sectionPosition(section.number)
    startPlacing(async () => {
      const r = await upsertDoorMarker({
        id: marker.id,
        rink_id: rinkId,
        door_type_id: marker.door_type_id,
        label: marker.label,
        position_x: pos.position_x,
        position_y: pos.position_y,
      })
      if (!r.ok) toast.error(r.error)
      else toast.success(`Moved to section ${section.number}.`)
    })
  }

  function onSectionActivate(section: DoorSection) {
    const occupants = markersBySection.get(section.number) ?? []
    if (mode === "place") {
      placeInSection(section)
      return
    }
    if (mode === "select") {
      if (occupants.length > 0) {
        onSelect(occupants[0].id)
        return
      }
      const selectedMarker = markers.find((m) => m.id === selectedId)
      if (selectedMarker) {
        moveSelectedToSection(section, selectedMarker)
      }
    }
  }

  // Logo drag (unchanged from the free-position editor — the logo is not a
  // board fixture, so it keeps full 2-D placement).
  function logoFrac(
    e: ReactPointerEvent<SVGSVGElement>,
  ): { x: number; y: number } | null {
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    }
  }

  function onSvgPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (mode !== "logo" || !logoUrl) return
    e.preventDefault()
    setLogoDragging(true)
    const frac = logoFrac(e)
    if (frac) setLogo({ ...logo, position_x: frac.x, position_y: frac.y })
  }

  function onSvgPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (mode !== "logo" || !logoDragging) return
    const frac = logoFrac(e)
    if (frac) setLogo({ ...logo, position_x: frac.x, position_y: frac.y })
  }

  function onSvgPointerUp() {
    if (mode === "logo" && logoDragging) {
      setLogoDragging(false)
      void updateRinkLogoLayout(rinkId, {
        position_x: logo.position_x,
        position_y: logo.position_y,
      }).then((r) => {
        if (!r.ok) toast.error(r.error)
      })
    }
  }

  const box = logoBox(logo, RINK_W, RINK_H)
  const sectionsInteractive = mode !== "logo"

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="bg-background relative w-full max-w-sm rounded-md border p-2"
        style={{ aspectRatio: `${RINK_W}/${RINK_H}` }}
      >
        <svg
          viewBox={`0 0 ${RINK_W} ${RINK_H}`}
          preserveAspectRatio="xMidYMid meet"
          className={cn(
            "h-full w-full select-none",
            mode === "logo" ? "cursor-grab" : "cursor-pointer",
          )}
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

          {/* Numbered perimeter sections (dasher-boards interaction). */}
          {sections.map((section) => {
            const occupants = markersBySection.get(section.number) ?? []
            const occupant = occupants[0]
            const occupantType = occupant
              ? typeById.get(occupant.door_type_id)
              : undefined
            const occupantColor =
              occupantType?.color ?? DOOR_MARKER_DEFAULT_COLOR
            const isSelectedSection =
              occupant != null && occupant.id === selectedId
            const anchor = sectionLabelAnchor(section)
            const mid = sectionPosition(section.number)
            const cx = mid.position_x * RINK_W
            const cy = mid.position_y * RINK_H
            return (
              <g
                key={section.number}
                {...(sectionsInteractive
                  ? {
                      role: "button",
                      tabIndex: 0,
                      "aria-label": occupant
                        ? `Section ${section.number}: ${markerTitle({
                            type_name: occupantType?.name ?? "Inactive type",
                            label: occupant.label,
                          })}`
                        : `Section ${section.number}: empty`,
                      onClick: () => onSectionActivate(section),
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          onSectionActivate(section)
                        }
                      },
                      className: "cursor-pointer focus:outline-none",
                    }
                  : {})}
              >
                {/* Enlarged transparent hit band along the span (butt caps so
                    a section never steals its neighbor's taps). */}
                {sectionsInteractive && (
                  <path
                    d={sectionPathD(section)}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={30}
                    strokeLinecap="butt"
                  />
                )}
                {/* Selection halo. */}
                {isSelectedSection && (
                  <path
                    d={sectionPathD(section)}
                    fill="none"
                    stroke="#4DFF00"
                    strokeWidth={11}
                    strokeLinecap="round"
                    opacity={0.35}
                  />
                )}
                {/* Section span: muted when empty, door-type color when
                    occupied. */}
                <path
                  d={sectionPathD(section)}
                  fill="none"
                  stroke={occupant ? occupantColor : SECTION_IDLE_COLOR}
                  strokeWidth={occupant ? 6 : 3.5}
                  strokeLinecap="round"
                  opacity={
                    occupant && (!occupantType || !occupantType.is_active)
                      ? 0.35
                      : occupant
                        ? 1
                        : 0.45
                  }
                />
                {/* Door glyph at the section midpoint. */}
                {occupant && (
                  <DoorMarkerGlyph
                    cx={cx}
                    cy={cy}
                    color={occupantColor}
                    title={`${markerTitle({
                      type_name: occupantType?.name ?? "Inactive type",
                      label: occupant.label,
                    })} (section ${section.number})`}
                    selected={isSelectedSection}
                  />
                )}
                {/* Section number chip, outward of the boards. */}
                <text
                  x={anchor.x}
                  y={anchor.y + 3.4}
                  textAnchor="middle"
                  fontSize={9.5}
                  fontWeight={isSelectedSection ? 800 : 600}
                  className={
                    isSelectedSection
                      ? "fill-foreground font-mono"
                      : "fill-muted-foreground font-mono"
                  }
                  pointerEvents="none"
                >
                  {section.number}
                </text>
              </g>
            )
          })}

          {/* Anchor marker: section 1 starts at the top-edge midpoint,
              clockwise — same convention as the Dasher Boards diagram. */}
          <g pointerEvents="none" aria-hidden="true">
            <text
              x={190}
              y={40}
              textAnchor="middle"
              fontSize={9}
              className="fill-muted-foreground font-mono"
            >
              section 1 →
            </text>
          </g>
        </svg>
        {placing && (
          <div className="text-muted-foreground bg-background/80 absolute right-2 top-2 rounded-md border px-2 py-1 text-xs">
            Saving…
          </div>
        )}
      </div>
      {markers.length === 0 && (
        <p className="text-muted-foreground text-sm">
          Pick a door type, then tap a numbered section on the boards to place
          your first door.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Selected-marker editor
// ---------------------------------------------------------------------------

function SelectedMarkerEditor({
  rinkId,
  marker,
  doorTypes,
  onClear,
}: {
  rinkId: string
  marker: DoorMarkerRow
  doorTypes: DoorTypeRow[]
  onClear: () => void
}) {
  const currentSection = nearestDoorSection(marker.position_x, marker.position_y)
  const [label, setLabel] = useState(marker.label ?? "")
  const [typeId, setTypeId] = useState(marker.door_type_id)
  const [section, setSection] = useState(currentSection)
  const [savePending, startSave] = useTransition()
  const [delPending, startDel] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)

  function onSave() {
    const pos = sectionPosition(section)
    startSave(async () => {
      const r = await upsertDoorMarker({
        id: marker.id,
        rink_id: rinkId,
        door_type_id: typeId,
        label,
        position_x: pos.position_x,
        position_y: pos.position_y,
      })
      if (!r.ok) toast.error(r.error)
      else toast.success("Door saved.")
    })
  }

  function onConfirmDelete() {
    setConfirmOpen(false)
    startDel(async () => {
      const r = await deleteDoorMarker(marker.id)
      if (!r.ok) toast.error(r.error)
      else {
        toast.success("Door deleted.")
        onClear()
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">
            Door — section {currentSection}
          </CardTitle>
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
          <Label htmlFor="dm-section">Section (1–{DOOR_SECTION_COUNT})</Label>
          <select
            id="dm-section"
            value={section}
            onChange={(e) => setSection(Number(e.target.value))}
            className="border-input bg-background h-9 rounded-md border px-2 py-1 text-sm"
          >
            {Array.from({ length: DOOR_SECTION_COUNT }, (_, i) => i + 1).map(
              (n) => (
                <option key={n} value={n}>
                  Section {n}
                </option>
              ),
            )}
          </select>
          <p className="text-muted-foreground text-xs">
            Numbered clockwise around the boards from center ice at the top.
            You can also tap another section on the diagram to move this door.
          </p>
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
  rinkId,
  config,
  logoUrl,
  logo,
  setLogo,
}: {
  rinkId: string
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
      const r = await updateRinkLogoLayout(rinkId, patch)
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
      const r = await removeRinkLogo(rinkId)
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
          <input type="hidden" name="rink_id" value={rinkId} />
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
