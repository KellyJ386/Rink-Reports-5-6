"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { ChevronDown, ChevronUp, GripVertical, X } from "lucide-react"
import { toast } from "sonner"

import { Badge, type BadgeProps } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

import {
  CUSTOM_LABEL_MAX,
  MAX_ALIASES,
} from "@/app/reports/dasher-boards/_lib/segment-labels"

import {
  moveZone,
  reorderSegments,
  setSegmentOutOfService,
  setZoneActive,
  updateSegmentDisplay,
  upsertZone,
} from "../actions"
import type { AssetRow, RinkRow, ZoneRow } from "../types"
import { BulkLabelCard } from "./bulk-labeler"

const SELECT_CLASS =
  "border-input bg-background h-9 rounded-md border px-3 py-1 text-sm"

const TYPE_LABELS: Record<string, string> = {
  board_panel: "Board",
  door: "Door",
  corner_radius: "Corner",
  post_gap: "Post gap",
}

function typeBadgeVariant(assetType: string): BadgeProps["variant"] {
  if (assetType === "door") return "special"
  if (assetType === "corner_radius") return "info"
  if (assetType === "post_gap") return "outline"
  return "secondary"
}

function arrayMove<T>(arr: readonly T[], from: number, to: number): T[] {
  const copy = arr.slice()
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item)
  return copy
}

export function LabelsTab({
  rink,
  assets,
  zones,
}: {
  rink: RinkRow
  assets: AssetRow[]
  zones: ZoneRow[]
}) {
  const positioned = useMemo(
    () =>
      assets
        .filter((a) => a.is_active && a.sequence_position !== null)
        .sort((a, b) => a.sequence_position! - b.sequence_position!),
    [assets],
  )
  const sortedZones = useMemo(
    () => [...zones].sort((a, b) => a.sort_order - b.sort_order),
    [zones],
  )
  const activeZones = useMemo(
    () => sortedZones.filter((z) => z.is_active),
    [sortedZones],
  )

  return (
    <div className="flex flex-col gap-6">
      <DatumBanner rink={rink} />
      <ZoneManagerCard rink={rink} zones={sortedZones} />
      <BulkLabelCard
        rink={rink}
        positioned={positioned}
        zones={activeZones}
        assets={assets}
      />
      <SegmentListCard rink={rink} positioned={positioned} zones={sortedZones} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Datum banner — every label, zone assignment, and walkthrough order below
// this screen is measured from position 1's start point and walk direction.
// ---------------------------------------------------------------------------

function DatumBanner({ rink }: { rink: RinkRow }) {
  const anchor = rink.perimeter_anchor_label || "your anchor point"
  return (
    <Card className="border-l-4 border-l-[var(--module-dasher)] gap-3 py-5">
      <CardHeader>
        <CardTitle>
          Position 1 starts at {anchor}, walking {rink.perimeter_direction}
        </CardTitle>
        <CardDescription>
          Every label, zone assignment, and walkthrough order on this screen
          is measured from this start point and direction. Changing it never
          renumbers or relabels anything, but it does change which position
          counts as &ldquo;1&rdquo; and which way the sequence runs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" size="sm">
          <Link href={`/admin/dasher-boards?tab=perimeter&rink=${rink.id}`}>
            Change start point or direction
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Zone manager
// ---------------------------------------------------------------------------

function ZoneManagerCard({ rink, zones }: { rink: RinkRow; zones: ZoneRow[] }) {
  const [pending, start] = useTransition()
  const [newName, setNewName] = useState("")

  function handleAdd() {
    const name = newName.trim()
    if (!name) {
      toast.error("Enter a zone name.")
      return
    }
    start(async () => {
      const r = await upsertZone(rink.id, null, name)
      if (!r.ok) toast.error(r.error)
      else {
        toast.success("Zone added.")
        setNewName("")
      }
    })
  }

  function handleMove(zoneId: string, direction: -1 | 1) {
    start(async () => {
      const r = await moveZone(zoneId, direction)
      if (!r.ok) toast.error(r.error)
    })
  }

  function handleToggleActive(zone: ZoneRow) {
    start(async () => {
      const r = await setZoneActive(zone.id, !zone.is_active)
      if (!r.ok) toast.error(r.error)
      else toast.success(zone.is_active ? "Zone deactivated." : "Zone reactivated.")
    })
  }

  function handleRename(zone: ZoneRow, value: string) {
    const next = value.trim()
    if (!next || next === zone.name) return
    start(async () => {
      const r = await upsertZone(rink.id, zone.id, next)
      if (!r.ok) toast.error(r.error)
      else toast.success("Zone renamed.")
    })
  }

  return (
    <Card className="gap-4 py-5">
      <CardHeader>
        <CardTitle>Zones</CardTitle>
        <CardDescription>
          Group segments into named areas (North End, Home Bench, etc.) for
          faster lookup during a walk and as bulk-labeling targets.
          Deactivating a zone keeps its assignment history but hides it from
          new assignments.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {zones.length === 0 ? (
          <p className="text-muted-foreground text-sm">No zones yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {zones.map((zone, i) => (
              <li
                key={zone.id}
                className={cn(
                  "flex flex-wrap items-center gap-2 rounded-md border border-border p-2",
                  !zone.is_active && "opacity-60",
                )}
              >
                <div className="flex flex-col">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    disabled={pending || i === 0}
                    aria-label="Move zone up"
                    onClick={() => handleMove(zone.id, -1)}
                  >
                    <ChevronUp className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    disabled={pending || i === zones.length - 1}
                    aria-label="Move zone down"
                    onClick={() => handleMove(zone.id, 1)}
                  >
                    <ChevronDown className="size-4" />
                  </Button>
                </div>
                <Input
                  key={`${zone.id}-${zone.name}`}
                  defaultValue={zone.name}
                  maxLength={60}
                  disabled={pending}
                  aria-label={`Rename ${zone.name}`}
                  className="h-9 max-w-56 flex-1"
                  onBlur={(e) => handleRename(zone, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur()
                  }}
                />
                {!zone.is_active && <Badge variant="secondary">Inactive</Badge>}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  disabled={pending}
                  onClick={() => handleToggleActive(zone)}
                >
                  {zone.is_active ? "Deactivate" : "Reactivate"}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2 border-t border-border pt-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="new-zone-name">New zone</Label>
            <Input
              id="new-zone-name"
              value={newName}
              maxLength={60}
              placeholder="e.g. North End"
              disabled={pending}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleAdd()
                }
              }}
            />
          </div>
          <Button onClick={handleAdd} disabled={pending || !newName.trim()}>
            Add zone
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Segment list — flat perimeter sequence, grouped for display by zone.
// Drag (dnd-kit/core) and the per-row up/down buttons both act on the
// underlying flat order and commit it whole via reorderSegments.
// ---------------------------------------------------------------------------

function SegmentListCard({
  rink,
  positioned,
  zones,
}: {
  rink: RinkRow
  positioned: AssetRow[]
  zones: ZoneRow[]
}) {
  const [orderIds, setOrderIds] = useState<string[]>(() =>
    positioned.map((a) => a.id),
  )
  const [reorderPending, startReorder] = useTransition()

  // Resync whenever the server delivers a fresh asset list (after any
  // mutation revalidates this page) — local order state only exists so a
  // drag/move reads back immediately, not as a source of truth. This is the
  // React "adjust state while rendering" pattern rather than an effect.
  const serverKey = positioned.map((a) => a.id).join("|")
  const [syncedKey, setSyncedKey] = useState(serverKey)
  if (syncedKey !== serverKey) {
    setSyncedKey(serverKey)
    setOrderIds(positioned.map((a) => a.id))
  }

  const byId = useMemo(
    () => new Map(positioned.map((a) => [a.id, a])),
    [positioned],
  )

  const groups = useMemo(() => {
    const byZone = new Map<string | null, AssetRow[]>()
    for (const id of orderIds) {
      const asset = byId.get(id)
      if (!asset) continue
      const arr = byZone.get(asset.zone_id) ?? []
      arr.push(asset)
      byZone.set(asset.zone_id, arr)
    }
    const result: Array<{ zone: ZoneRow | null; segments: AssetRow[] }> = []
    for (const zone of zones) {
      const segs = byZone.get(zone.id)
      if (segs && segs.length > 0) result.push({ zone, segments: segs })
    }
    const noZone = byZone.get(null)
    if (noZone && noZone.length > 0) result.push({ zone: null, segments: noZone })
    return result
  }, [orderIds, byId, zones])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  function commit(next: string[]) {
    setOrderIds(next)
    startReorder(async () => {
      const r = await reorderSegments(rink.id, next)
      if (!r.ok) {
        toast.error(r.error)
        // Roll the optimistic order back to the server's actual order.
        setOrderIds(positioned.map((a) => a.id))
      }
    })
  }

  function moveInOrder(id: string, direction: -1 | 1) {
    const idx = orderIds.indexOf(id)
    const swapWith = idx + direction
    if (idx === -1 || swapWith < 0 || swapWith >= orderIds.length) return
    commit(arrayMove(orderIds, idx, swapWith))
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const activeIdx = orderIds.indexOf(String(active.id))
    const overIdx = orderIds.indexOf(String(over.id))
    if (activeIdx === -1 || overIdx === -1) return
    commit(arrayMove(orderIds, activeIdx, overIdx))
  }

  return (
    <Card className="gap-4 py-5">
      <CardHeader>
        <CardTitle>Segments ({positioned.length})</CardTitle>
        <CardDescription>
          Every active board, door, corner, and post-gap position in
          perimeter order, grouped by zone. Drag the handle — or use the
          arrows — to reorder within the sequence; glass rides its parent
          board and isn&apos;t listed here (edit it on the Perimeter tab).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {positioned.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No positioned segments yet — build the perimeter on the Perimeter
            tab first.
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <div className="flex flex-col gap-5">
              {groups.map(({ zone, segments }) => (
                <div key={zone?.id ?? "no-zone"} className="flex flex-col gap-2">
                  <h3 className="text-muted-foreground text-sm font-semibold">
                    {zone?.name ?? "No zone"}{" "}
                    <span className="font-normal">({segments.length})</span>
                  </h3>
                  <ul className="flex flex-col gap-1.5">
                    {segments.map((asset) => (
                      <SegmentRow
                        key={asset.id}
                        asset={asset}
                        zones={zones}
                        index={orderIds.indexOf(asset.id)}
                        total={orderIds.length}
                        dragDisabled={reorderPending}
                        onMove={moveInOrder}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </DndContext>
        )}
      </CardContent>
    </Card>
  )
}

function SegmentRow({
  asset,
  zones,
  index,
  total,
  dragDisabled,
  onMove,
}: {
  asset: AssetRow
  zones: ZoneRow[]
  index: number
  total: number
  dragDisabled: boolean
  onMove: (id: string, direction: -1 | 1) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
    isDragging,
  } = useDraggable({ id: asset.id, disabled: dragDisabled })
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: asset.id })

  const style = transform
    ? { transform: CSS.Translate.toString(transform), zIndex: 20 }
    : undefined

  return (
    <li
      ref={(node) => {
        setDragRef(node)
        setDropRef(node)
      }}
      style={style}
      className={cn(
        "rounded-md border border-border bg-card",
        isDragging && "opacity-70 shadow-[var(--shadow-elev-1)]",
        isOver && !isDragging && "border-primary ring-2 ring-primary/30",
      )}
    >
      <div className="flex items-center gap-2 p-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={dragDisabled}
          aria-label={`Drag ${asset.custom_label ?? asset.label} to reorder`}
          className="text-muted-foreground cursor-grab touch-none px-1 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <GripVertical className="size-4" />
        </button>
        <div className="flex flex-col">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            disabled={dragDisabled || index <= 0}
            aria-label="Move up"
            onClick={() => onMove(asset.id, -1)}
          >
            <ChevronUp className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            disabled={dragDisabled || index === -1 || index >= total - 1}
            aria-label="Move down"
            onClick={() => onMove(asset.id, 1)}
          >
            <ChevronDown className="size-4" />
          </Button>
        </div>
        <button
          type="button"
          className="flex flex-1 flex-wrap items-center gap-2 text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="font-mono text-base font-semibold">
            {asset.custom_label ?? asset.label}
          </span>
          {asset.custom_label && (
            <span className="text-muted-foreground font-mono text-xs">
              ({asset.label})
            </span>
          )}
          <Badge variant={typeBadgeVariant(asset.asset_type)}>
            {TYPE_LABELS[asset.asset_type] ?? asset.asset_type}
          </Badge>
          {asset.out_of_service && <Badge variant="warning">Out of service</Badge>}
        </button>
        <span className="text-muted-foreground hidden font-mono text-xs sm:inline">
          pos {asset.sequence_position}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Close" : "Edit"}
        </Button>
      </div>
      {expanded && <SegmentEditor asset={asset} zones={zones} />}
    </li>
  )
}

function SegmentEditor({ asset, zones }: { asset: AssetRow; zones: ZoneRow[] }) {
  const [pending, start] = useTransition()
  const [oosPending, startOos] = useTransition()
  const [customLabel, setCustomLabel] = useState(asset.custom_label ?? "")
  const [zoneId, setZoneId] = useState(asset.zone_id ?? "")
  const [aliases, setAliases] = useState<string[]>(asset.aliases ?? [])
  const [aliasDraft, setAliasDraft] = useState("")

  // The assignable set is active zones — plus the asset's CURRENT zone even
  // if it has since been deactivated, so opening the editor never silently
  // drops an existing (inactive) assignment out of the select before Save.
  const zoneOptions = useMemo(
    () => zones.filter((z) => z.is_active || z.id === asset.zone_id),
    [zones, asset.zone_id],
  )

  function addAlias() {
    const value = aliasDraft.trim()
    if (!value) return
    if (aliases.length >= MAX_ALIASES) {
      toast.error(`Up to ${MAX_ALIASES} aliases per segment.`)
      return
    }
    if (aliases.some((a) => a.toLowerCase() === value.toLowerCase())) {
      setAliasDraft("")
      return
    }
    setAliases((prev) => [...prev, value])
    setAliasDraft("")
  }

  function removeAlias(value: string) {
    setAliases((prev) => prev.filter((a) => a !== value))
  }

  function save() {
    const trimmed = customLabel.trim()
    if (trimmed.length > CUSTOM_LABEL_MAX) {
      toast.error(`Custom labels are up to ${CUSTOM_LABEL_MAX} characters.`)
      return
    }
    start(async () => {
      const r = await updateSegmentDisplay(asset.id, {
        customLabel: trimmed === "" ? null : trimmed,
        aliases,
        zoneId: zoneId === "" ? null : zoneId,
      })
      if (!r.ok) toast.error(r.error)
      else toast.success("Segment updated.")
    })
  }

  function clearOverride() {
    setCustomLabel("")
    if (asset.custom_label === null) return
    start(async () => {
      const r = await updateSegmentDisplay(asset.id, {
        customLabel: null,
        aliases,
        zoneId: zoneId === "" ? null : zoneId,
      })
      if (!r.ok) toast.error(r.error)
      else toast.success("Custom label cleared.")
    })
  }

  function toggleOutOfService(next: boolean) {
    startOos(async () => {
      const r = await setSegmentOutOfService(asset.id, next)
      if (!r.ok) toast.error(r.error)
      else toast.success(next ? "Marked out of service." : "Back in service.")
    })
  }

  const showClear = asset.custom_label !== null || customLabel.trim() !== ""

  return (
    <div className="flex flex-col gap-4 border-t border-border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`custom-label-${asset.id}`}>Custom label</Label>
          <div className="flex gap-2">
            <Input
              id={`custom-label-${asset.id}`}
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              placeholder={asset.label}
              className="h-9 font-mono"
              disabled={pending}
            />
            {showClear && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={clearOverride}
              >
                Clear
              </Button>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            Permanent label: <span className="font-mono">{asset.label}</span>
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`zone-${asset.id}`}>Zone</Label>
          <select
            id={`zone-${asset.id}`}
            className={SELECT_CLASS}
            value={zoneId}
            onChange={(e) => setZoneId(e.target.value)}
            disabled={pending}
          >
            <option value="">No zone</option>
            {zoneOptions.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
                {!z.is_active ? " (inactive)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>
          Aliases{" "}
          <span className="text-muted-foreground font-normal">
            ({aliases.length}/{MAX_ALIASES})
          </span>
        </Label>
        <div className="flex flex-wrap items-center gap-1.5">
          {aliases.length === 0 && (
            <span className="text-muted-foreground text-xs">None</span>
          )}
          {aliases.map((a) => (
            <span
              key={a}
              className="bg-muted inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
            >
              {a}
              <button
                type="button"
                aria-label={`Remove alias ${a}`}
                disabled={pending}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => removeAlias(a)}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Input
            value={aliasDraft}
            onChange={(e) => setAliasDraft(e.target.value)}
            placeholder="Add a search alias"
            className="h-8 w-56 text-xs"
            disabled={pending || aliases.length >= MAX_ALIASES}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addAlias()
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || !aliasDraft.trim() || aliases.length >= MAX_ALIASES}
            onClick={addAlias}
          >
            Add
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 rounded-md border border-border p-2">
        <div>
          <Label>Out of service</Label>
          <p className="text-muted-foreground text-xs">
            Flags this segment on walk checklists until returned to service.
          </p>
        </div>
        <Switch
          checked={asset.out_of_service}
          disabled={oosPending}
          aria-label="Out of service"
          onCheckedChange={toggleOutOfService}
        />
      </div>

      <div>
        <Button size="sm" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  )
}
