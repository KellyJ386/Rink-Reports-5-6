"use client"

import { useMemo, useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
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
import { Textarea } from "@/components/ui/textarea"
import { RinkPerimeter } from "@/components/rink/rink-perimeter"
import type { RinkPerimeterGlass } from "@/components/rink/rink-perimeter"
import { thicknessToFraction } from "@/app/reports/dasher-boards/_lib/compute"

import {
  bulkSetGlassSpec,
  convertAssetToDoor,
  convertDoorToBoard,
  generatePerimeter,
  insertAsset,
  relabelAsset,
  removeAsset,
  setDoorSubtype,
  setGlassSpec,
  setPerimeterAnchor,
  toggleGlass,
} from "../actions"
import type { AssetRow, GlassSpecInput, RinkRow, SubtypeRow } from "../types"
import { GLASS_MATERIALS } from "../types"
import { RinkSettingsCard } from "./rink-settings-card"

const SELECT_CLASS =
  "border-input bg-background h-9 rounded-md border px-3 py-1 text-sm"

function hasSpec(a: AssetRow): boolean {
  return (
    a.glass_width_in !== null ||
    a.glass_height_in !== null ||
    a.glass_thickness_in !== null ||
    a.glass_material !== null
  )
}

export function PerimeterTab({
  rink,
  assets,
  doorSubtypes,
}: {
  rink: RinkRow
  assets: AssetRow[]
  doorSubtypes: SubtypeRow[]
}) {
  const positioned = useMemo(
    () =>
      assets
        .filter(
          (a) =>
            (a.asset_type === "board_panel" || a.asset_type === "door") &&
            a.is_active &&
            a.sequence_position !== null,
        )
        .sort((a, b) => a.sequence_position! - b.sequence_position!),
    [assets],
  )
  const glassByParent = useMemo(() => {
    const map = new Map<string, AssetRow>()
    for (const a of assets) {
      if (a.asset_type === "glass_panel" && a.parent_board_id) {
        map.set(a.parent_board_id, a)
      }
    }
    return map
  }, [assets])
  const retired = useMemo(
    () =>
      assets.filter(
        (a) => a.asset_type !== "glass_panel" && !a.is_active,
      ),
    [assets],
  )

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showGlass, setShowGlass] = useState(false)
  const [pickingAnchor, setPickingAnchor] = useState(false)
  const [, startAnchor] = useTransition()
  const selected = positioned.find((a) => a.id === selectedId) ?? null

  function handlePickAnchor(offsetFraction: number) {
    startAnchor(async () => {
      const r = await setPerimeterAnchor(rink.id, offsetFraction)
      if (!r.ok) toast.error(r.error)
      else {
        toast.success("Start point updated — the diagram rotated to match.")
        setPickingAnchor(false)
      }
    })
  }

  if (positioned.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <StartPointCard rink={rink} />
        <SequenceBuilderCard rink={rink} />
        <RinkSettingsCard mode="edit" rink={rink} />
      </div>
    )
  }

  const glassForDiagram: Record<string, RinkPerimeterGlass> = {}
  for (const [parentId, g] of glassByParent) {
    glassForDiagram[parentId] = {
      id: g.id,
      label: g.label,
      parentBoardId: parentId,
      isActive: g.is_active,
      hasSpec: hasSpec(g),
    }
  }

  const doorCount = positioned.filter((a) => a.asset_type === "door").length
  const unspeccedGlass = assets.filter(
    (a) =>
      ((a.asset_type === "glass_panel" && a.is_active) ||
        a.asset_type === "door") &&
      !hasSpec(a),
  ).length

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Perimeter editor</CardTitle>
              <CardDescription>
                Tap a position on the diagram to edit it — mark doors, relabel,
                insert or remove positions, toggle glass, and enter replacement
                specs. Existing assets are never renumbered.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {positioned.length - doorCount} panels
              </Badge>
              <Badge variant="secondary">{doorCount} doors</Badge>
              {unspeccedGlass > 0 && (
                <Badge variant="outline">{unspeccedGlass} without spec</Badge>
              )}
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={showGlass} onCheckedChange={setShowGlass} />
                Glass layer
              </label>
              <Button
                type="button"
                size="sm"
                variant={pickingAnchor ? "default" : "outline"}
                onClick={() => {
                  setSelectedId(null)
                  setPickingAnchor((v) => !v)
                }}
              >
                {pickingAnchor ? "Cancel" : "Set start point"}
              </Button>
            </div>
          </div>
          {pickingAnchor && (
            <p className="text-muted-foreground text-sm">
              Click anywhere on the boundary to set where position 1 starts.
              Existing labels never move — the diagram rotates to match.
            </p>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="w-full">
              <RinkPerimeter
                positioned={positioned.map((a) => ({
                  id: a.id,
                  label: a.label,
                  asset_type: a.asset_type as "board_panel" | "door",
                }))}
                direction={
                  rink.perimeter_direction as "clockwise" | "counterclockwise"
                }
                anchorOffsetFraction={rink.perimeter_anchor_offset}
                glassByParent={glassForDiagram}
                selectedAssetId={pickingAnchor ? null : selectedId}
                onSelectAsset={
                  pickingAnchor
                    ? undefined
                    : (id) => setSelectedId((cur) => (cur === id ? null : id))
                }
                onPickAnchor={pickingAnchor ? handlePickAnchor : undefined}
                showGlassLayer={showGlass}
              />
            </div>
            <div className="flex flex-col gap-3">
              {selected ? (
                <SelectedAssetPanel
                  key={selected.id}
                  rink={rink}
                  asset={selected}
                  glassChild={glassByParent.get(selected.id) ?? null}
                  doorSubtypes={doorSubtypes}
                  onClear={() => setSelectedId(null)}
                />
              ) : (
                <div className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
                  No position selected. Tap a board or door on the diagram to
                  edit it.
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <BulkSpecCard
        rink={rink}
        glassRows={positioned
          .filter((a) => a.asset_type === "board_panel")
          .map((a) => ({ parent: a, glass: glassByParent.get(a.id) ?? null }))
          .filter((x): x is { parent: AssetRow; glass: AssetRow } => !!x.glass)}
      />

      {retired.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Retired positions ({retired.length})</CardTitle>
            <CardDescription>
              Removed with issue history preserved. Their labels stay attached
              to that history forever and are never reused.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {retired.map((a) => (
              <Badge key={a.id} variant="outline" className="font-mono">
                {a.label}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      <RinkSettingsCard mode="edit" rink={rink} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Wizard step 1.5: pick the start point, before any positions exist
// ---------------------------------------------------------------------------

function StartPointCard({ rink }: { rink: RinkRow }) {
  const [pickingAnchor, setPickingAnchor] = useState(false)
  const [pending, start] = useTransition()

  function handlePickAnchor(offsetFraction: number) {
    start(async () => {
      const r = await setPerimeterAnchor(rink.id, offsetFraction)
      if (!r.ok) toast.error(r.error)
      else {
        toast.success("Start point set.")
        setPickingAnchor(false)
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Start point</CardTitle>
            <CardDescription>
              Where position 1 begins on the diagram
              {rink.perimeter_anchor_label ? ` (${rink.perimeter_anchor_label})` : ""}.
              Set it now, or generate positions first and set it later —
              either order works, and it can be changed anytime.
            </CardDescription>
          </div>
          <Button
            type="button"
            size="sm"
            variant={pickingAnchor ? "default" : "outline"}
            disabled={pending}
            onClick={() => setPickingAnchor((v) => !v)}
          >
            {pickingAnchor ? "Cancel" : "Click to set"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mx-auto w-full max-w-xs">
          <RinkPerimeter
            positioned={[]}
            direction={rink.perimeter_direction as "clockwise" | "counterclockwise"}
            anchorOffsetFraction={rink.perimeter_anchor_offset}
            onPickAnchor={pickingAnchor ? handlePickAnchor : undefined}
          />
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Wizard step 2: sequence builder
// ---------------------------------------------------------------------------

function SequenceBuilderCard({ rink }: { rink: RinkRow }) {
  const [count, setCount] = useState("40")
  const [pending, start] = useTransition()

  function onGenerate() {
    const n = Math.trunc(Number(count))
    if (!Number.isFinite(n) || n < 1 || n > 500) {
      toast.error("Enter a position count between 1 and 500.")
      return
    }
    start(async () => {
      const r = await generatePerimeter(rink.id, n)
      if (!r.ok) toast.error(r.error)
      else toast.success(`Generated ${n} board positions with 1:1 glass.`)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sequence builder</CardTitle>
        <CardDescription>
          Enter the number of board positions around the perimeter, counted
          from {rink.perimeter_anchor_label || "your anchor point"} going{" "}
          {rink.perimeter_direction}. Every position starts as a uniform board
          panel with a 1:1 glass row; you&apos;ll mark the doors by tapping
          them on the diagram right after.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="db-position-count">Board positions</Label>
          <Input
            id="db-position-count"
            inputMode="numeric"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="w-32"
          />
        </div>
        <Button onClick={onGenerate} disabled={pending}>
          {pending ? "Generating…" : "Generate perimeter"}
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Selected-asset side panel
// ---------------------------------------------------------------------------

function SelectedAssetPanel({
  rink,
  asset,
  glassChild,
  doorSubtypes,
  onClear,
}: {
  rink: RinkRow
  asset: AssetRow
  glassChild: AssetRow | null
  doorSubtypes: SubtypeRow[]
  onClear: () => void
}) {
  const isDoor = asset.asset_type === "door"
  const [pending, start] = useTransition()
  const [label, setLabel] = useState(asset.label)
  const [subtypeId, setSubtypeId] = useState(asset.subtype_id ?? "")

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) {
    start(async () => {
      const r = await fn()
      if (!r.ok) toast.error(r.error ?? "Failed.")
      else if (okMsg) toast.success(okMsg)
    })
  }

  const specTarget = isDoor ? asset : glassChild

  return (
    <div className="flex flex-col gap-4 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-lg font-bold">{asset.label}</span>
          <Badge variant={isDoor ? "special" : "secondary"}>
            {isDoor ? "Door" : "Board panel"}
          </Badge>
          <span className="text-muted-foreground text-xs">
            pos {asset.sequence_position}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          aria-label="Clear selection"
        >
          ✕
        </Button>
      </div>

      {/* Door marking — the primary setup path for doors. */}
      <div className="flex flex-col gap-2">
        <Label>{isDoor ? "Door subtype" : "This is a door"}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={SELECT_CLASS}
            value={subtypeId}
            onChange={(e) => {
              setSubtypeId(e.target.value)
              if (isDoor) {
                run(
                  () => setDoorSubtype(asset.id, e.target.value || null),
                  "Subtype updated.",
                )
              }
            }}
            aria-label="Door subtype"
          >
            <option value="">No subtype</option>
            {doorSubtypes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          {isDoor ? (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => {
                if (
                  !confirm(
                    `Convert ${asset.label} back to a board panel? It gets the next board number; ${asset.label} is retired forever.`,
                  )
                )
                  return
                run(() => convertDoorToBoard(asset.id), "Converted to board.")
              }}
            >
              Convert to board
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(
                  () => convertAssetToDoor(asset.id, subtypeId || null),
                  "Marked as a door.",
                )
              }
            >
              Mark as door
            </Button>
          )}
        </div>
        {!isDoor && (
          <p className="text-muted-foreground text-xs">
            The position keeps its row and issue history but takes the next
            door number; its separate glass row parks (the door carries its own
            glass spec).
          </p>
        )}
      </div>

      {/* Relabel */}
      <div className="flex flex-col gap-2">
        <Label htmlFor={`relabel-${asset.id}`}>Label</Label>
        <div className="flex gap-2">
          <Input
            id={`relabel-${asset.id}`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="h-9 font-mono"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={pending || label.trim() === asset.label}
            onClick={() =>
              run(() => relabelAsset(asset.id, label), "Relabeled.")
            }
          >
            Save
          </Button>
        </div>
      </div>

      {/* Insert / remove */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(
              () =>
                insertAsset(
                  rink.id,
                  asset.sequence_position!,
                  "board_panel",
                ),
              "Board inserted after this position.",
            )
          }
        >
          + Board after
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(
              () => insertAsset(rink.id, asset.sequence_position!, "door"),
              "Door inserted after this position.",
            )
          }
        >
          + Door after
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={() => {
            if (
              !confirm(
                `Remove ${asset.label}? With issue history it is retired (history kept); with none it is deleted. The sequence gap closes either way.`,
              )
            )
              return
            run(async () => {
              const r = await removeAsset(asset.id)
              if (r.ok) onClear()
              return r
            }, "Removed.")
          }}
        >
          Remove
        </Button>
      </div>

      {/* Glass on/off (board positions only) */}
      {!isDoor && (
        <div className="flex items-center justify-between gap-2">
          <div>
            <Label>Glass at this position</Label>
            <p className="text-muted-foreground text-xs">
              Turn off for sections with no shielding.
            </p>
          </div>
          {glassChild ? (
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={glassChild.is_active}
                disabled={pending}
                onCheckedChange={(v) =>
                  run(
                    () => toggleGlass(glassChild.id, v),
                    v ? "Glass enabled." : "Glass disabled.",
                  )
                }
              />
              <span className="font-mono">{glassChild.label}</span>
            </label>
          ) : (
            <span className="text-muted-foreground text-xs">No glass row</span>
          )}
        </div>
      )}

      {/* Replacement spec (glass child, or the door itself) */}
      {specTarget && (isDoor || specTarget.is_active) && (
        <GlassSpecForm key={specTarget.id} target={specTarget} />
      )}
    </div>
  )
}

function GlassSpecForm({ target }: { target: AssetRow }) {
  const [pending, start] = useTransition()
  const [width, setWidth] = useState(
    target.glass_width_in === null ? "" : String(target.glass_width_in),
  )
  const [height, setHeight] = useState(
    target.glass_height_in === null ? "" : String(target.glass_height_in),
  )
  const [thickness, setThickness] = useState(
    target.glass_thickness_in === null ? "" : String(target.glass_thickness_in),
  )
  const [material, setMaterial] = useState(target.glass_material ?? "")
  const [notes, setNotes] = useState(target.spec_notes ?? "")

  const thicknessNum = Number(thickness)
  const fractionHint =
    thickness && Number.isFinite(thicknessNum) && thicknessNum > 0
      ? `${thicknessToFraction(thicknessNum)}"`
      : null

  function toNum(v: string): number | null {
    if (v.trim() === "") return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  function onSave() {
    const spec: GlassSpecInput = {
      widthIn: toNum(width),
      heightIn: toNum(height),
      thicknessIn: toNum(thickness),
      material: (material || null) as GlassSpecInput["material"],
      notes: notes.trim() || null,
    }
    start(async () => {
      const r = await setGlassSpec(target.id, spec)
      if (!r.ok) toast.error(r.error)
      else toast.success("Replacement spec saved.")
    })
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
      <div className="flex items-center justify-between">
        <Label>
          Replacement spec{" "}
          <span className="text-muted-foreground font-mono text-xs">
            ({target.label})
          </span>
        </Label>
        {!hasSpec(target) && <Badge variant="warning">No spec on file</Badge>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          aria-label="Width (in)"
          placeholder="Width (in)"
          inputMode="decimal"
          value={width}
          onChange={(e) => setWidth(e.target.value)}
          className="h-9 font-mono"
        />
        <Input
          aria-label="Height (in)"
          placeholder="Height (in)"
          inputMode="decimal"
          value={height}
          onChange={(e) => setHeight(e.target.value)}
          className="h-9 font-mono"
        />
        <div className="flex flex-col gap-0.5">
          <Input
            aria-label="Thickness (in)"
            placeholder="Thickness (in)"
            inputMode="decimal"
            value={thickness}
            onChange={(e) => setThickness(e.target.value)}
            className="h-9 font-mono"
          />
          {fractionHint && (
            <span className="text-muted-foreground font-mono text-xs">
              = {fractionHint}
            </span>
          )}
        </div>
        <select
          aria-label="Material"
          className={SELECT_CLASS}
          value={material}
          onChange={(e) => setMaterial(e.target.value)}
        >
          <option value="">Material…</option>
          {GLASS_MATERIALS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <Textarea
        aria-label="Spec notes"
        placeholder="Notes (radius/curved panel, supplier, part numbers)…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
      />
      <Button size="sm" onClick={onSave} disabled={pending}>
        {pending ? "Saving…" : "Save spec"}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bulk glass spec — the primary spec-entry path (one side-panel size + a few
// exceptions). Ranges are picked over glass rows in perimeter order.
// ---------------------------------------------------------------------------

function BulkSpecCard({
  rink,
  glassRows,
}: {
  rink: RinkRow
  glassRows: Array<{ parent: AssetRow; glass: AssetRow }>
}) {
  const [pending, start] = useTransition()
  const [fromIdx, setFromIdx] = useState(0)
  const [toIdx, setToIdx] = useState(Math.max(glassRows.length - 1, 0))
  const [width, setWidth] = useState("")
  const [height, setHeight] = useState("")
  const [thickness, setThickness] = useState("")
  const [material, setMaterial] = useState("")

  if (glassRows.length === 0) return null

  function toNum(v: string): number | null {
    if (v.trim() === "") return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  function onApply() {
    const lo = Math.min(fromIdx, toIdx)
    const hi = Math.max(fromIdx, toIdx)
    const ids = glassRows.slice(lo, hi + 1).map((x) => x.glass.id)
    const spec: GlassSpecInput = {
      widthIn: toNum(width),
      heightIn: toNum(height),
      thicknessIn: toNum(thickness),
      material: (material || null) as GlassSpecInput["material"],
      notes: null,
    }
    start(async () => {
      const r = await bulkSetGlassSpec(rink.id, ids, spec)
      if (!r.ok) toast.error(r.error)
      else toast.success(`Spec applied to ${r.updated ?? ids.length} glass panels.`)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk glass spec</CardTitle>
        <CardDescription>
          Apply one replacement spec across a range of glass panels (e.g.
          G1–G30: 68 × 72, 5/8 tempered), then override the exceptions — radius
          corners, ends, each door&apos;s glass — individually on the diagram.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>From</Label>
          <select
            className={SELECT_CLASS}
            value={fromIdx}
            onChange={(e) => setFromIdx(Number(e.target.value))}
            aria-label="Range start"
          >
            {glassRows.map((x, i) => (
              <option key={x.glass.id} value={i}>
                {x.glass.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>To</Label>
          <select
            className={SELECT_CLASS}
            value={toIdx}
            onChange={(e) => setToIdx(Number(e.target.value))}
            aria-label="Range end"
          >
            {glassRows.map((x, i) => (
              <option key={x.glass.id} value={i}>
                {x.glass.label}
              </option>
            ))}
          </select>
        </div>
        <Input
          aria-label="Width (in)"
          placeholder="Width (in)"
          inputMode="decimal"
          value={width}
          onChange={(e) => setWidth(e.target.value)}
          className="h-9 w-28 font-mono"
        />
        <Input
          aria-label="Height (in)"
          placeholder="Height (in)"
          inputMode="decimal"
          value={height}
          onChange={(e) => setHeight(e.target.value)}
          className="h-9 w-28 font-mono"
        />
        <Input
          aria-label="Thickness (in)"
          placeholder="Thick. (in)"
          inputMode="decimal"
          value={thickness}
          onChange={(e) => setThickness(e.target.value)}
          className="h-9 w-24 font-mono"
        />
        <select
          aria-label="Material"
          className={SELECT_CLASS}
          value={material}
          onChange={(e) => setMaterial(e.target.value)}
        >
          <option value="">Material…</option>
          {GLASS_MATERIALS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <Button onClick={onApply} disabled={pending}>
          {pending ? "Applying…" : "Apply to range"}
        </Button>
      </CardContent>
    </Card>
  )
}
