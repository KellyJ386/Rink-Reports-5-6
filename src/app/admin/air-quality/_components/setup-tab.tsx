"use client"

import Link from "next/link"
import { useActionState, useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

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
  createEquipment,
  createLocation,
  createReadingType,
  createThreshold,
  deleteEquipment,
  deleteLocation,
  deleteReadingType,
  deleteThreshold,
  moveReadingType,
  setEquipmentActive,
  setLocationActive,
  setReadingTypeActive,
  setThresholdActive,
  updateEquipment,
  updateLocation,
  updateReadingType,
  updateThreshold,
} from "../actions"
import type {
  ActionState,
  EquipmentRow,
  LocationDetail,
  LocationRow,
  LocationWithCounts,
  ReadingTypeRow,
  Severity,
  SetupData,
  ThresholdRow,
} from "../types"
import { SEVERITIES } from "../types"

import { SeedDefaultsCard } from "./seed-defaults-card"

const NULL_STATE: ActionState = { ok: null }

export function SetupTab({ data }: { data: SetupData }) {
  const {
    locations,
    facilityEquipment,
    readingTypes,
    thresholds,
    detail,
    activeLocationId,
    allLocations,
  } = data

  if (locations.length === 0 && readingTypes.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <SeedDefaultsCard />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LocationCreateCard />
          <ReadingTypeCreateCard />
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[20rem_1fr]">
      <div className="flex flex-col gap-3">
        <ReadingTypesCard
          readingTypes={readingTypes}
          thresholds={thresholds}
          locations={allLocations}
        />
        <LocationsList
          locations={locations}
          activeLocationId={activeLocationId}
        />
        <LocationCreateCard />
      </div>
      <div className="flex flex-col gap-6">
        <FacilityEquipmentCard equipment={facilityEquipment} />
        {detail ? (
          <LocationDetailPane detail={detail} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Pick a location</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm">
                Select a location from the list to manage its equipment.
                Reading types and their thresholds are managed at the top
                left and apply across all locations.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Locations — list + create
// ---------------------------------------------------------------------------

function LocationsList({
  locations,
  activeLocationId,
}: {
  locations: LocationWithCounts[]
  activeLocationId: string | null
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Locations</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 p-2">
        {locations.length === 0 ? (
          <p className="text-muted-foreground p-2 text-sm">
            No locations yet.
          </p>
        ) : (
          locations.map((l) => (
            <Link
              key={l.id}
              href={`/admin/air-quality?tab=setup&location=${l.id}`}
              className={cn(
                "flex flex-col gap-0.5 rounded-md px-3 py-2 text-sm transition-colors",
                activeLocationId === l.id
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{l.name}</span>
                {!l.is_active && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase",
                      activeLocationId === l.id
                        ? "bg-primary-foreground/20"
                        : "bg-muted",
                    )}
                  >
                    off
                  </span>
                )}
              </div>
              <span
                className={cn(
                  "text-xs",
                  activeLocationId === l.id
                    ? "text-primary-foreground/80"
                    : "text-muted-foreground",
                )}
              >
                {l.equipment_count} equipment
              </span>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function LocationCreateCard() {
  const [state, action, pending] = useActionState(createLocation, NULL_STATE)
  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Location created.")
    if (state.ok === false) toast.error(state.error)
  }, [state])
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add location</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-loc-name">Name</Label>
            <Input
              id="new-loc-name"
              name="name"
              required
              placeholder="e.g. Main Rink"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-loc-slug">
              Slug{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Input
              id="new-loc-slug"
              name="slug"
              placeholder="auto-generated from name"
            />
          </div>
          <Button type="submit" disabled={pending} size="sm">
            {pending ? "Adding…" : "Add location"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Location detail pane
// ---------------------------------------------------------------------------

function LocationDetailPane({ detail }: { detail: LocationDetail }) {
  const { location, equipment } = detail
  return (
    <div className="flex flex-col gap-6">
      <LocationHeader location={location} />
      <EquipmentBlock
        title={`Equipment at ${location.name} (${equipment.length})`}
        description="Equipment scoped to this location only."
        equipment={equipment}
        locationId={location.id}
      />
    </div>
  )
}

function LocationHeader({ location }: { location: LocationRow }) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState(updateLocation, NULL_STATE)
  const [activePending, startActiveTransition] = useTransition()
  const [delPending, startDelTransition] = useTransition()

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Location updated.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  function onToggleActive() {
    startActiveTransition(async () => {
      const r = await setLocationActive(location.id, !location.is_active)
      if (!r.ok) toast.error(r.error)
    })
  }
  function onDelete() {
    if (
      !confirm(
        "Delete this location? This will fail if equipment, reports, or thresholds reference it. Deactivate instead if needed.",
      )
    ) {
      return
    }
    startDelTransition(async () => {
      const r = await deleteLocation(location.id)
      if (!r.ok) toast.error(r.error)
      else {
        toast.success("Location deleted.")
        window.location.href = "/admin/air-quality?tab=setup"
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            {location.name}
            {!location.is_active && (
              <Badge variant="secondary" className="uppercase">inactive</Badge>
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
              {location.is_active ? "Deactivate" : "Activate"}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={onDelete}
              disabled={delPending}
            >
              Delete
            </Button>
          </div>
        </div>
      </CardHeader>
      {editing && (
        <CardContent>
          <form action={action} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={location.id} />
            <div className="flex flex-col gap-1">
              <Label htmlFor={`loc-name-${location.id}`}>Name</Label>
              <Input
                id={`loc-name-${location.id}`}
                name="name"
                defaultValue={location.name}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`loc-slug-${location.id}`}>Slug</Label>
              <Input
                id={`loc-slug-${location.id}`}
                name="slug"
                defaultValue={location.slug}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`loc-sort-${location.id}`}>Sort</Label>
              <Input
                id={`loc-sort-${location.id}`}
                name="sort_order"
                type="number"
                defaultValue={location.sort_order}
                className="w-24"
              />
            </div>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </form>
        </CardContent>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Equipment block (used both for location-scoped and facility-wide)
// ---------------------------------------------------------------------------

function FacilityEquipmentCard({ equipment }: { equipment: EquipmentRow[] }) {
  return (
    <EquipmentBlock
      title={`Facility-wide equipment (${equipment.length})`}
      description="Equipment not tied to a specific location (location_id is null)."
      equipment={equipment}
      locationId={null}
    />
  )
}

function EquipmentBlock({
  title,
  description,
  equipment,
  locationId,
}: {
  title: string
  description: string
  equipment: EquipmentRow[]
  locationId: string | null
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-muted-foreground text-sm">{description}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {equipment.length === 0 ? (
          <p className="text-muted-foreground text-sm">No equipment yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {equipment.map((eq) => (
              <EquipmentRowItem key={eq.id} equipment={eq} />
            ))}
          </ul>
        )}
        <EquipmentCreateForm locationId={locationId} />
      </CardContent>
    </Card>
  )
}

function EquipmentRowItem({ equipment }: { equipment: EquipmentRow }) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState(updateEquipment, NULL_STATE)
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Equipment updated.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  function onToggleActive() {
    startActive(async () => {
      const r = await setEquipmentActive(equipment.id, !equipment.is_active)
      if (!r.ok) toast.error(r.error)
    })
  }
  function onDelete() {
    if (!confirm(`Delete equipment "${equipment.name}"?`)) return
    startDel(async () => {
      const r = await deleteEquipment(equipment.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Equipment deleted.")
    })
  }

  return (
    <li className="bg-muted/30 flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{equipment.name}</span>
          <span className="text-muted-foreground text-xs">
            ({equipment.slug})
          </span>
          {equipment.model && (
            <span className="text-muted-foreground text-xs">
              {equipment.model}
            </span>
          )}
          {!equipment.is_active && (
            <Badge variant="secondary" className="uppercase">off</Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Cancel" : "Edit"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleActive}
            disabled={activePending}
          >
            {equipment.is_active ? "Deactivate" : "Activate"}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            disabled={delPending}
          >
            Delete
          </Button>
        </div>
      </div>
      {editing && (
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={equipment.id} />
          <div className="flex flex-col gap-1">
            <Label htmlFor={`eq-name-${equipment.id}`}>Name</Label>
            <Input
              id={`eq-name-${equipment.id}`}
              name="name"
              defaultValue={equipment.name}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`eq-slug-${equipment.id}`}>Slug</Label>
            <Input
              id={`eq-slug-${equipment.id}`}
              name="slug"
              defaultValue={equipment.slug}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`eq-model-${equipment.id}`}>Model</Label>
            <Input
              id={`eq-model-${equipment.id}`}
              name="model"
              defaultValue={equipment.model ?? ""}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`eq-serial-${equipment.id}`}>Serial</Label>
            <Input
              id={`eq-serial-${equipment.id}`}
              name="serial_number"
              defaultValue={equipment.serial_number ?? ""}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`eq-sort-${equipment.id}`}>Sort</Label>
            <Input
              id={`eq-sort-${equipment.id}`}
              name="sort_order"
              type="number"
              defaultValue={equipment.sort_order}
              className="w-24"
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      )}
    </li>
  )
}

function EquipmentCreateForm({ locationId }: { locationId: string | null }) {
  const [state, action, pending] = useActionState(createEquipment, NULL_STATE)
  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Equipment created.")
    if (state.ok === false) toast.error(state.error)
  }, [state])
  const idSuffix = locationId ?? "facility"
  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-3 rounded-md border p-3"
    >
      {locationId && (
        <input type="hidden" name="location_id" value={locationId} />
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor={`new-eq-name-${idSuffix}`}>New equipment</Label>
        <Input
          id={`new-eq-name-${idSuffix}`}
          name="name"
          required
          placeholder="e.g. Sensor A"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`new-eq-slug-${idSuffix}`}>Slug (optional)</Label>
        <Input id={`new-eq-slug-${idSuffix}`} name="slug" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`new-eq-model-${idSuffix}`}>Model (optional)</Label>
        <Input id={`new-eq-model-${idSuffix}`} name="model" />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "Add equipment"}
      </Button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Reading types (facility-level) + thresholds (per reading type +/- location)
// ---------------------------------------------------------------------------

function ReadingTypesCard({
  readingTypes,
  thresholds,
  locations,
}: {
  readingTypes: ReadingTypeRow[]
  thresholds: ThresholdRow[]
  locations: LocationRow[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reading types ({readingTypes.length})</CardTitle>
        <p className="text-muted-foreground text-sm">
          Reading types apply across all locations. Thresholds can be
          facility-wide or scoped to a single location.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {readingTypes.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No reading types yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {readingTypes.map((rt) => (
              <ReadingTypeRowItem
                key={rt.id}
                readingType={rt}
                thresholds={thresholds.filter(
                  (t) => t.reading_type_id === rt.id,
                )}
                locations={locations}
              />
            ))}
          </ul>
        )}
        <ReadingTypeCreateCard inline />
      </CardContent>
    </Card>
  )
}

function ReadingTypeCreateCard({ inline = false }: { inline?: boolean }) {
  const [state, action, pending] = useActionState(
    createReadingType,
    NULL_STATE,
  )
  useEffect(() => {
    if (state.ok === true)
      toast.success(state.message ?? "Reading type created.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  const Form = (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="new-rt-label">Label</Label>
          <Input id="new-rt-label" name="label" required placeholder="CO" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="new-rt-key">Key (optional)</Label>
          <Input
            id="new-rt-key"
            name="key"
            placeholder="auto from label (e.g. co_ppm)"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="new-rt-unit">Unit</Label>
          <Input id="new-rt-unit" name="unit" required placeholder="ppm" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="new-rt-decimals">Decimals</Label>
          <Input
            id="new-rt-decimals"
            name="decimals"
            type="number"
            min={0}
            max={6}
            defaultValue={0}
            className="w-24"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="new-rt-required"
          name="is_required"
          type="checkbox"
          defaultChecked
          className="border-input size-4 rounded border"
        />
        <Label htmlFor="new-rt-required" className="cursor-pointer">
          Required on reports
        </Label>
      </div>
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add reading type"}
        </Button>
      </div>
    </form>
  )

  if (inline) {
    return <div className="rounded-md border p-3">{Form}</div>
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add reading type</CardTitle>
      </CardHeader>
      <CardContent>{Form}</CardContent>
    </Card>
  )
}

function ReadingTypeRowItem({
  readingType,
  thresholds,
  locations,
}: {
  readingType: ReadingTypeRow
  thresholds: ThresholdRow[]
  locations: LocationRow[]
}) {
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [state, action, pending] = useActionState(
    updateReadingType,
    NULL_STATE,
  )
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()
  const [movePending, startMove] = useTransition()

  useEffect(() => {
    if (state.ok === true)
      toast.success(state.message ?? "Reading type updated.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  function onToggleActive() {
    startActive(async () => {
      const r = await setReadingTypeActive(
        readingType.id,
        !readingType.is_active,
      )
      if (!r.ok) toast.error(r.error)
    })
  }
  function onDelete() {
    if (!confirm(`Delete reading type "${readingType.label}"?`)) return
    startDel(async () => {
      const r = await deleteReadingType(readingType.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Reading type deleted.")
    })
  }
  function onMove(dir: -1 | 1) {
    startMove(async () => {
      const r = await moveReadingType(readingType.id, dir)
      if (!r.ok) toast.error(r.error)
    })
  }

  return (
    <li className="bg-muted/30 flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{readingType.label}</span>
          <span className="text-muted-foreground text-xs">
            ({readingType.key}, {readingType.unit}, {readingType.decimals} dec)
          </span>
          {readingType.is_required && (
            <Badge variant="secondary" className="uppercase">required</Badge>
          )}
          {!readingType.is_active && (
            <Badge variant="secondary" className="uppercase">off</Badge>
          )}
          {thresholds.length > 0 && (
            <Badge variant="secondary">
              {thresholds.length} threshold
              {thresholds.length === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onMove(-1)}
            disabled={movePending}
            aria-label="Move up"
          >
            ↑
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onMove(1)}
            disabled={movePending}
            aria-label="Move down"
          >
            ↓
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Hide thresholds" : "Thresholds"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Cancel" : "Edit"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleActive}
            disabled={activePending}
          >
            {readingType.is_active ? "Deactivate" : "Activate"}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            disabled={delPending}
          >
            Delete
          </Button>
        </div>
      </div>

      {editing && (
        <form action={action} className="flex flex-col gap-3 border-t pt-3">
          <input type="hidden" name="id" value={readingType.id} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`rt-label-${readingType.id}`}>Label</Label>
              <Input
                id={`rt-label-${readingType.id}`}
                name="label"
                defaultValue={readingType.label}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`rt-key-${readingType.id}`}>Key</Label>
              <Input
                id={`rt-key-${readingType.id}`}
                name="key"
                defaultValue={readingType.key}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`rt-unit-${readingType.id}`}>Unit</Label>
              <Input
                id={`rt-unit-${readingType.id}`}
                name="unit"
                defaultValue={readingType.unit}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`rt-decimals-${readingType.id}`}>Decimals</Label>
              <Input
                id={`rt-decimals-${readingType.id}`}
                name="decimals"
                type="number"
                min={0}
                max={6}
                defaultValue={readingType.decimals}
                className="w-24"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`rt-sort-${readingType.id}`}>Sort</Label>
              <Input
                id={`rt-sort-${readingType.id}`}
                name="sort_order"
                type="number"
                defaultValue={readingType.sort_order}
                className="w-24"
              />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input
                id={`rt-required-${readingType.id}`}
                name="is_required"
                type="checkbox"
                defaultChecked={readingType.is_required}
                className="border-input size-4 rounded border"
              />
              <Label
                htmlFor={`rt-required-${readingType.id}`}
                className="cursor-pointer"
              >
                Required on reports
              </Label>
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      )}

      {expanded && (
        <div className="border-t pt-3">
          <ThresholdsBlock
            readingType={readingType}
            thresholds={thresholds}
            locations={locations}
          />
        </div>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Thresholds block (collapsible under each reading type)
// ---------------------------------------------------------------------------

function severityBadgeVariant(sev: Severity): "destructive" | "warning" {
  if (sev === "critical") return "destructive"
  return "warning"
}

function ThresholdsBlock({
  readingType,
  thresholds,
  locations,
}: {
  readingType: ReadingTypeRow
  thresholds: ThresholdRow[]
  locations: LocationRow[]
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">
          Thresholds ({thresholds.length})
        </h4>
      </div>
      {thresholds.length === 0 ? (
        <p className="text-muted-foreground text-sm">No thresholds yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {thresholds.map((t) => (
            <ThresholdRowItem
              key={t.id}
              threshold={t}
              locations={locations}
            />
          ))}
        </ul>
      )}
      <ThresholdCreateForm readingType={readingType} locations={locations} />
    </div>
  )
}

function fmtRange(min: number | null, max: number | null): string {
  if (min === null && max === null) return "—"
  if (min === null) return `≤ ${max}`
  if (max === null) return `≥ ${min}`
  return `${min} – ${max}`
}

function ThresholdRowItem({
  threshold,
  locations,
}: {
  threshold: ThresholdRow
  locations: LocationRow[]
}) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState(updateThreshold, NULL_STATE)
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()
  const sev = threshold.severity as Severity
  const [editSev, setEditSev] = useState<Severity>(sev)

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Threshold updated.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  function onToggleActive() {
    startActive(async () => {
      const r = await setThresholdActive(threshold.id, !threshold.is_active)
      if (!r.ok) toast.error(r.error)
    })
  }
  function onDelete() {
    if (!confirm("Delete this threshold?")) return
    startDel(async () => {
      const r = await deleteThreshold(threshold.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Threshold deleted.")
    })
  }

  const scopeName =
    threshold.location_id === null
      ? "All locations"
      : (locations.find((l) => l.id === threshold.location_id)?.name ??
        "Unknown")

  return (
    <li className="bg-background flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{scopeName}</span>
          <Badge variant={severityBadgeVariant(sev)} className="uppercase">
            {sev}
          </Badge>
          {!threshold.is_active && (
            <Badge variant="secondary" className="uppercase">off</Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Cancel" : "Edit"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleActive}
            disabled={activePending}
          >
            {threshold.is_active ? "Deactivate" : "Activate"}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            disabled={delPending}
          >
            Delete
          </Button>
        </div>
      </div>
      <div className="text-muted-foreground grid grid-cols-1 gap-1 text-xs sm:grid-cols-3">
        <span>
          Warn: {fmtRange(threshold.warn_min, threshold.warn_max)}
        </span>
        <span>
          Alert: {fmtRange(threshold.alert_min, threshold.alert_max)}
        </span>
        <span>
          Compliance:{" "}
          {fmtRange(threshold.compliance_min, threshold.compliance_max)}
        </span>
      </div>
      {editing && (
        <form action={action} className="flex flex-col gap-3 border-t pt-3">
          <input type="hidden" name="id" value={threshold.id} />
          <ThresholdValueInputs threshold={threshold} />
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`th-sev-${threshold.id}`}>Severity</Label>
              <input type="hidden" name="severity" value={editSev} />
              <Select
                value={editSev}
                onValueChange={(v) => setEditSev(v as Severity)}
              >
                <SelectTrigger id={`th-sev-${threshold.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      )}
    </li>
  )
}

function ThresholdValueInputs({
  threshold,
}: {
  threshold: ThresholdRow | null
}) {
  const id = threshold?.id ?? "new"
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`th-warnmin-${id}`}>Warn min</Label>
        <Input
          id={`th-warnmin-${id}`}
          name="warn_min"
          type="number"
          step="any"
          defaultValue={threshold?.warn_min ?? ""}
          className="w-full"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`th-warnmax-${id}`}>Warn max</Label>
        <Input
          id={`th-warnmax-${id}`}
          name="warn_max"
          type="number"
          step="any"
          defaultValue={threshold?.warn_max ?? ""}
          className="w-full"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`th-alertmin-${id}`}>Alert min</Label>
        <Input
          id={`th-alertmin-${id}`}
          name="alert_min"
          type="number"
          step="any"
          defaultValue={threshold?.alert_min ?? ""}
          className="w-full"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`th-alertmax-${id}`}>Alert max</Label>
        <Input
          id={`th-alertmax-${id}`}
          name="alert_max"
          type="number"
          step="any"
          defaultValue={threshold?.alert_max ?? ""}
          className="w-full"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`th-cmin-${id}`}>Compliance min</Label>
        <Input
          id={`th-cmin-${id}`}
          name="compliance_min"
          type="number"
          step="any"
          defaultValue={threshold?.compliance_min ?? ""}
          className="w-full"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`th-cmax-${id}`}>Compliance max</Label>
        <Input
          id={`th-cmax-${id}`}
          name="compliance_max"
          type="number"
          step="any"
          defaultValue={threshold?.compliance_max ?? ""}
          className="w-full"
        />
      </div>
    </div>
  )
}

function ThresholdCreateForm({
  readingType,
  locations,
}: {
  readingType: ReadingTypeRow
  locations: LocationRow[]
}) {
  const [state, action, pending] = useActionState(createThreshold, NULL_STATE)
  const [locationId, setLocationId] = useState("")
  const [severity, setSeverity] = useState<Severity>("warn")

  useEffect(() => {
    if (state.ok === true)
      toast.success(state.message ?? "Threshold created.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  return (
    <form action={action} className="flex flex-col gap-3 rounded-md border p-3">
      <input type="hidden" name="reading_type_id" value={readingType.id} />
      <input type="hidden" name="location_id" value={locationId} />
      <input type="hidden" name="severity" value={severity} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`new-th-loc-${readingType.id}`}>Scope</Label>
          <Select
            value={locationId || undefined}
            onValueChange={(v) => setLocationId(v)}
          >
            <SelectTrigger id={`new-th-loc-${readingType.id}`} className="min-w-40">
              <SelectValue placeholder="All locations" />
            </SelectTrigger>
            <SelectContent>
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`new-th-sev-${readingType.id}`}>Severity</Label>
          <Select
            value={severity}
            onValueChange={(v) => setSeverity(v as Severity)}
          >
            <SelectTrigger id={`new-th-sev-${readingType.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEVERITIES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <ThresholdValueInputs threshold={null} />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add threshold"}
        </Button>
      </div>
    </form>
  )
}
