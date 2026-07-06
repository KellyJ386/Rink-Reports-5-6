"use client"

import { useRouter } from "next/navigation"
import {
  useActionState,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react"
import { toast } from "sonner"

import {
  BulkUploadPanel,
  type ImportSchema,
} from "@/components/admin/bulk-upload"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

import {
  createCircleCheckItem,
  createCircleCheckTemplate,
  createCircleCheckTemplateItem,
  createEquipment,
  createFuelType,
  createRink,
  deleteCircleCheckItem,
  importCircleCheckItems,
  importCircleCheckTemplateItems,
  deleteCircleCheckTemplate,
  deleteCircleCheckTemplateItem,
  deleteEquipment,
  deleteFuelType,
  deleteRink,
  moveCircleCheckItem,
  setCircleCheckItemActive,
  setCircleCheckTemplateActive,
  setCircleCheckTemplateItemActive,
  setEquipmentActive,
  setFuelTypeActive,
  setRinkActive,
  updateCircleCheckItem,
  updateCircleCheckTemplate,
  updateCircleCheckTemplateItem,
  updateEquipment,
  updateFuelType,
  updateRink,
} from "../actions"
import type {
  ActionState,
  CircleCheckItemRow,
  CircleCheckTemplateItemRow,
  CircleCheckTemplateRow,
  EquipmentRow,
  EquipmentType,
  FuelTypeRow,
  RinkRow,
} from "../types"
import {
  CIRCLE_CHECK_BULK_CAP,
  CIRCLE_CHECK_TEMPLATE_CAP,
  EQUIPMENT_TYPES,
  equipmentTypeLabel,
} from "../types"

import {
  circleCheckItemsImportSpec,
  circleCheckTemplateItemsImportSpec,
} from "./circle-check-import"
import { SeedDefaultsCard } from "./seed-defaults-card"

const NULL_STATE: ActionState = { ok: null }

type Props = {
  rinks: RinkRow[]
  equipment: EquipmentRow[]
  circleCheckItems: CircleCheckItemRow[]
  fuelTypes: FuelTypeRow[]
  templates: CircleCheckTemplateRow[]
  templateItems: CircleCheckTemplateItemRow[]
}

export function SetupTab({
  rinks,
  equipment,
  circleCheckItems,
  fuelTypes,
  templates,
  templateItems,
}: Props) {
  const showSeed = rinks.length === 0 && circleCheckItems.length === 0

  return (
    <div className="flex flex-col gap-6">
      {showSeed && <SeedDefaultsCard />}
      <RinksCard rinks={rinks} />
      <FuelTypesCard fuelTypes={fuelTypes} />
      <EquipmentCard equipment={equipment} fuelTypes={fuelTypes} />
      <CircleCheckTemplatesCard
        fuelTypes={fuelTypes}
        templates={templates}
        templateItems={templateItems}
      />
      <CircleCheckItemsCard items={circleCheckItems} />
    </div>
  )
}

// ===========================================================================
// Rinks card
// ===========================================================================

function RinksCard({ rinks }: { rinks: RinkRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rinks ({rinks.length})</CardTitle>
        <CardDescription>
          Surfaces that ice operations are performed on.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rinks.length === 0 ? (
          <p className="text-muted-foreground text-sm">No rinks yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rinks.map((r) => (
              <RinkRowItem key={r.id} rink={r} />
            ))}
          </ul>
        )}
        <RinkCreateForm />
      </CardContent>
    </Card>
  )
}

function RinkRowItem({ rink }: { rink: RinkRow }) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState(updateRink, NULL_STATE)
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Rink updated.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  function onToggleActive() {
    startActive(async () => {
      const r = await setRinkActive(rink.id, !rink.is_active)
      if (!r.ok) toast.error(r.error)
    })
  }
  function onDelete() {
    if (!confirm(`Delete rink "${rink.name}"?`)) return
    startDel(async () => {
      const r = await deleteRink(rink.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Rink deleted.")
    })
  }

  return (
    <li className="bg-muted/30 flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{rink.name}</span>
          <span className="text-muted-foreground text-xs">({rink.slug})</span>
          {!rink.is_active && (
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
            {rink.is_active ? "Deactivate" : "Activate"}
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
          <input type="hidden" name="id" value={rink.id} />
          <div className="flex flex-col gap-1">
            <Label htmlFor={`rink-name-${rink.id}`}>Name</Label>
            <Input
              id={`rink-name-${rink.id}`}
              name="name"
              defaultValue={rink.name}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`rink-slug-${rink.id}`}>Slug</Label>
            <Input
              id={`rink-slug-${rink.id}`}
              name="slug"
              defaultValue={rink.slug}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`rink-sort-${rink.id}`}>Sort</Label>
            <Input
              id={`rink-sort-${rink.id}`}
              name="sort_order"
              type="number"
              defaultValue={rink.sort_order}
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

function RinkCreateForm() {
  const [state, action, pending] = useActionState(createRink, NULL_STATE)
  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Rink created.")
    if (state.ok === false) toast.error(state.error)
  }, [state])
  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-3 rounded-md border p-3"
      key={state.ok === true ? "rink-form-ok" : "rink-form"}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-rink-name">Add rink — Name</Label>
        <Input id="new-rink-name" name="name" required placeholder="e.g. Main Rink" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-rink-slug">Slug (optional)</Label>
        <Input id="new-rink-slug" name="slug" placeholder="auto from name" />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "Add rink"}
      </Button>
    </form>
  )
}

// ===========================================================================
// Equipment card
// ===========================================================================

function EquipmentCard({
  equipment,
  fuelTypes,
}: {
  equipment: EquipmentRow[]
  fuelTypes: FuelTypeRow[]
}) {
  const groups = new Map<EquipmentType, EquipmentRow[]>()
  for (const t of EQUIPMENT_TYPES) groups.set(t.key, [])
  for (const eq of equipment) {
    const k = (
      EQUIPMENT_TYPES.find((t) => t.key === eq.equipment_type)?.key ?? "other"
    ) as EquipmentType
    groups.get(k)?.push(eq)
  }
  const activeFuelTypes = fuelTypes.filter((f) => f.is_active)
  const fuelById = new Map(fuelTypes.map((f) => [f.id, f]))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Equipment ({equipment.length})</CardTitle>
        <CardDescription>
          Hours count is admin-maintained and does not auto-update from
          submissions.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {EQUIPMENT_TYPES.map((t) => {
          const items = groups.get(t.key) ?? []
          return (
            <div key={t.key} className="flex flex-col gap-2">
              <h4 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                {t.label} ({items.length})
              </h4>
              {items.length === 0 ? (
                <p className="text-muted-foreground text-sm italic">
                  No {t.label.toLowerCase()} yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {items.map((eq) => (
                    <EquipmentRowItem
                      key={eq.id}
                      equipment={eq}
                      fuelTypes={activeFuelTypes}
                      fuelById={fuelById}
                    />
                  ))}
                </ul>
              )}
            </div>
          )
        })}
        <EquipmentCreateForm fuelTypes={activeFuelTypes} />
      </CardContent>
    </Card>
  )
}

function EquipmentRowItem({
  equipment,
  fuelTypes,
  fuelById,
}: {
  equipment: EquipmentRow
  fuelTypes: FuelTypeRow[]
  fuelById: Map<string, FuelTypeRow>
}) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState(updateEquipment, NULL_STATE)
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()
  const [equipmentType, setEquipmentType] = useState(equipment.equipment_type)
  const [fuelTypeId, setFuelTypeId] = useState<string>(
    equipment.fuel_type_id ?? "",
  )
  const fuelLabel = equipment.fuel_type_id
    ? (fuelById.get(equipment.fuel_type_id)?.name ?? null)
    : null

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
              · {equipment.model}
            </span>
          )}
          {equipment.serial_number && (
            <span className="text-muted-foreground text-xs">
              · S/N {equipment.serial_number}
            </span>
          )}
          {equipment.hours_count !== null && (
            <Badge variant="secondary">{equipment.hours_count} hrs</Badge>
          )}
          {equipment.tank_capacity_gal !== null && (
            <Badge variant="secondary">
              {equipment.tank_capacity_gal} gal tank
            </Badge>
          )}
          {fuelLabel && <Badge variant="outline">{fuelLabel}</Badge>}
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
        <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <Label htmlFor={`eq-type-${equipment.id}`}>Type</Label>
            <input type="hidden" name="equipment_type" value={equipmentType} />
            <Select value={equipmentType} onValueChange={(v) => setEquipmentType(v as EquipmentType)}>
              <SelectTrigger id={`eq-type-${equipment.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EQUIPMENT_TYPES.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <Label htmlFor={`eq-serial-${equipment.id}`}>Serial number</Label>
            <Input
              id={`eq-serial-${equipment.id}`}
              name="serial_number"
              defaultValue={equipment.serial_number ?? ""}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`eq-hours-${equipment.id}`}>Hours count</Label>
            <Input
              id={`eq-hours-${equipment.id}`}
              name="hours_count"
              type="number"
              step="any"
              defaultValue={equipment.hours_count ?? ""}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`eq-tank-${equipment.id}`}>
              Tank capacity (gal)
            </Label>
            <Input
              id={`eq-tank-${equipment.id}`}
              name="tank_capacity_gal"
              type="number"
              step="any"
              min="0"
              placeholder="Enables % of tank on ice make"
              defaultValue={equipment.tank_capacity_gal ?? ""}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`eq-fuel-${equipment.id}`}>Fuel type</Label>
            <input type="hidden" name="fuel_type_id" value={fuelTypeId} />
            <Select
              value={fuelTypeId || undefined}
              onValueChange={(v) => setFuelTypeId(v)}
            >
              <SelectTrigger id={`eq-fuel-${equipment.id}`}>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                {fuelTypes.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <div className="sm:col-span-2 flex justify-end">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      )}
    </li>
  )
}

function EquipmentCreateForm({ fuelTypes }: { fuelTypes: FuelTypeRow[] }) {
  const [state, action, pending] = useActionState(createEquipment, NULL_STATE)
  const [newEqType, setNewEqType] = useState<EquipmentType>("ice_resurfacer")
  const [newFuelTypeId, setNewFuelTypeId] = useState<string>("")

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Equipment created.")
    if (state.ok === false) toast.error(state.error)
  }, [state])
  return (
    <form
      action={action}
      className="grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-2"
      key={state.ok === true ? "eq-form-ok" : "eq-form"}
    >
      <input type="hidden" name="equipment_type" value={newEqType} />
      <input type="hidden" name="fuel_type_id" value={newFuelTypeId} />
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-eq-name">Add equipment — Name</Label>
        <Input id="new-eq-name" name="name" required placeholder="e.g. Ice Resurfacer 1" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-eq-type">Type</Label>
        <Select value={newEqType} onValueChange={(v) => setNewEqType(v as EquipmentType)}>
          <SelectTrigger id="new-eq-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EQUIPMENT_TYPES.map((t) => (
              <SelectItem key={t.key} value={t.key}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-eq-slug">Slug (optional)</Label>
        <Input id="new-eq-slug" name="slug" placeholder="auto from name" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-eq-model">Model (optional)</Label>
        <Input id="new-eq-model" name="model" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-eq-serial">Serial number (optional)</Label>
        <Input id="new-eq-serial" name="serial_number" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-eq-hours">Hours count (optional)</Label>
        <Input id="new-eq-hours" name="hours_count" type="number" step="any" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-eq-tank">Tank capacity (gal, optional)</Label>
        <Input
          id="new-eq-tank"
          name="tank_capacity_gal"
          type="number"
          step="any"
          min="0"
          placeholder="Enables % of tank on ice make"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-eq-fuel">Fuel type (optional)</Label>
        <Select
          value={newFuelTypeId || undefined}
          onValueChange={(v) => setNewFuelTypeId(v)}
        >
          <SelectTrigger id="new-eq-fuel">
            <SelectValue
              placeholder={
                fuelTypes.length === 0
                  ? "Add fuel types first"
                  : "Select a fuel type"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {fuelTypes.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="sm:col-span-2 flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add equipment"}
        </Button>
      </div>
    </form>
  )
}

// ===========================================================================
// Circle Check Items card
// ===========================================================================

function CircleCheckItemsCard({ items }: { items: CircleCheckItemRow[] }) {
  const router = useRouter()
  const total = items.length
  const atCap = total >= CIRCLE_CHECK_BULK_CAP

  const importSchema: ImportSchema = useMemo(
    () => ({
      ...circleCheckItemsImportSpec,
      onImport: (rows) => importCircleCheckItems(rows),
    }),
    [],
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Circle check items ({total})</CardTitle>
            <CardDescription>
              Items shown to staff during a circle check. Up to{" "}
              {CIRCLE_CHECK_BULK_CAP} total per facility.
            </CardDescription>
          </div>
          <BulkUploadPanel
            schema={importSchema}
            disabled={atCap}
            onImported={() => router.refresh()}
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No circle-check items yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item, idx) => (
              <CircleCheckItemRowItem
                key={item.id}
                item={item}
                isFirst={idx === 0}
                isLast={idx === items.length - 1}
              />
            ))}
          </ul>
        )}
        {total < CIRCLE_CHECK_BULK_CAP && <CircleCheckCreateForm />}
        {total >= CIRCLE_CHECK_BULK_CAP && (
          <p className="text-muted-foreground text-xs">
            Cap of {CIRCLE_CHECK_BULK_CAP} items reached. Delete or merge an
            item before adding more.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function CircleCheckItemRowItem({
  item,
  isFirst,
  isLast,
}: {
  item: CircleCheckItemRow
  isFirst: boolean
  isLast: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState(
    updateCircleCheckItem,
    NULL_STATE,
  )
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()
  const [movePending, startMove] = useTransition()
  const [appliesToType, setAppliesToType] = useState(item.applies_to_equipment_type ?? "")

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Item updated.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  function onToggleActive() {
    startActive(async () => {
      const r = await setCircleCheckItemActive(item.id, !item.is_active)
      if (!r.ok) toast.error(r.error)
    })
  }
  function onDelete() {
    if (!confirm(`Delete item "${item.label}"?`)) return
    startDel(async () => {
      const r = await deleteCircleCheckItem(item.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Item deleted.")
    })
  }
  function onMove(dir: -1 | 1) {
    startMove(async () => {
      const r = await moveCircleCheckItem(item.id, dir)
      if (!r.ok) toast.error(r.error)
    })
  }

  const scopeLabel = item.applies_to_equipment_type
    ? equipmentTypeLabel(item.applies_to_equipment_type)
    : "All"

  return (
    <li className="bg-muted/30 flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{item.label}</span>
          <Badge
            variant={item.applies_to_equipment_type ? "secondary" : "outline"}
            className="uppercase"
          >
            {scopeLabel}
          </Badge>
          {!item.is_active && (
            <Badge variant="secondary" className="uppercase">off</Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onMove(-1)}
            disabled={movePending || isFirst}
            aria-label="Move up"
          >
            ↑
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onMove(1)}
            disabled={movePending || isLast}
            aria-label="Move down"
          >
            ↓
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
            {item.is_active ? "Deactivate" : "Activate"}
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
      {item.description && !editing && (
        <p className="text-muted-foreground text-xs">{item.description}</p>
      )}
      {editing && (
        <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={item.id} />
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor={`cci-label-${item.id}`}>Label</Label>
            <Input
              id={`cci-label-${item.id}`}
              name="label"
              defaultValue={item.label}
              required
            />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor={`cci-desc-${item.id}`}>Description (optional)</Label>
            <Textarea
              id={`cci-desc-${item.id}`}
              name="description"
              rows={2}
              defaultValue={item.description ?? ""}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`cci-scope-${item.id}`}>Applies to</Label>
            <input type="hidden" name="applies_to_equipment_type" value={appliesToType} />
            <Select
              value={appliesToType || undefined}
              onValueChange={(v) => setAppliesToType(v)}
            >
              <SelectTrigger id={`cci-scope-${item.id}`}>
                <SelectValue placeholder="All equipment" />
              </SelectTrigger>
              <SelectContent>
                {EQUIPMENT_TYPES.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      )}
    </li>
  )
}

function CircleCheckCreateForm() {
  const [state, action, pending] = useActionState(
    createCircleCheckItem,
    NULL_STATE,
  )
  const [newCciType, setNewCciType] = useState("")

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Item created.")
    if (state.ok === false) toast.error(state.error)
  }, [state])
  return (
    <form
      action={action}
      className="grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-2"
      key={state.ok === true ? "cci-form-ok" : "cci-form"}
    >
      <input type="hidden" name="applies_to_equipment_type" value={newCciType} />
      <div className="flex flex-col gap-1 sm:col-span-2">
        <Label htmlFor="new-cci-label">Add item — Label</Label>
        <Input
          id="new-cci-label"
          name="label"
          required
          placeholder="e.g. Tires in good condition"
        />
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <Label htmlFor="new-cci-desc">Description (optional)</Label>
        <Textarea id="new-cci-desc" name="description" rows={2} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-cci-scope">Applies to</Label>
        <Select
          value={newCciType || undefined}
          onValueChange={(v) => setNewCciType(v)}
        >
          <SelectTrigger id="new-cci-scope">
            <SelectValue placeholder="All equipment" />
          </SelectTrigger>
          <SelectContent>
            {EQUIPMENT_TYPES.map((t) => (
              <SelectItem key={t.key} value={t.key}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="sm:col-span-2 flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add item"}
        </Button>
      </div>
    </form>
  )
}

// ===========================================================================
// Fuel Types card
// ===========================================================================

function FuelTypesCard({ fuelTypes }: { fuelTypes: FuelTypeRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fuel types ({fuelTypes.length})</CardTitle>
        <CardDescription>
          Power sources for ice resurfacers (e.g. Electric, Gas, Propane). Each
          fuel type can anchor a circle-check template.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {fuelTypes.length === 0 ? (
          <p className="text-muted-foreground text-sm">No fuel types yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {fuelTypes.map((f) => (
              <FuelTypeRowItem key={f.id} fuelType={f} />
            ))}
          </ul>
        )}
        <FuelTypeCreateForm />
      </CardContent>
    </Card>
  )
}

function FuelTypeRowItem({ fuelType }: { fuelType: FuelTypeRow }) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState(updateFuelType, NULL_STATE)
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Fuel type updated.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  function onToggleActive() {
    startActive(async () => {
      const r = await setFuelTypeActive(fuelType.id, !fuelType.is_active)
      if (!r.ok) toast.error(r.error)
    })
  }
  function onDelete() {
    if (!confirm(`Delete fuel type "${fuelType.name}"?`)) return
    startDel(async () => {
      const r = await deleteFuelType(fuelType.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Fuel type deleted.")
    })
  }

  return (
    <li className="bg-muted/30 flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{fuelType.name}</span>
          <span className="text-muted-foreground text-xs">
            ({fuelType.slug})
          </span>
          {!fuelType.is_active && (
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
            {fuelType.is_active ? "Deactivate" : "Activate"}
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
          <input type="hidden" name="id" value={fuelType.id} />
          <div className="flex flex-col gap-1">
            <Label htmlFor={`ft-name-${fuelType.id}`}>Name</Label>
            <Input
              id={`ft-name-${fuelType.id}`}
              name="name"
              defaultValue={fuelType.name}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`ft-slug-${fuelType.id}`}>Slug</Label>
            <Input
              id={`ft-slug-${fuelType.id}`}
              name="slug"
              defaultValue={fuelType.slug}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`ft-sort-${fuelType.id}`}>Sort</Label>
            <Input
              id={`ft-sort-${fuelType.id}`}
              name="sort_order"
              type="number"
              defaultValue={fuelType.sort_order}
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

function FuelTypeCreateForm() {
  const [state, action, pending] = useActionState(createFuelType, NULL_STATE)
  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Fuel type created.")
    if (state.ok === false) toast.error(state.error)
  }, [state])
  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-3 rounded-md border p-3"
      key={state.ok === true ? "ft-form-ok" : "ft-form"}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-ft-name">Add fuel type — Name</Label>
        <Input
          id="new-ft-name"
          name="name"
          required
          placeholder="e.g. Electric, Gas"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-ft-slug">Slug (optional)</Label>
        <Input id="new-ft-slug" name="slug" placeholder="auto from name" />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "Add fuel type"}
      </Button>
    </form>
  )
}

// ===========================================================================
// Circle Check Templates card
// ===========================================================================

function CircleCheckTemplatesCard({
  fuelTypes,
  templates,
  templateItems,
}: {
  fuelTypes: FuelTypeRow[]
  templates: CircleCheckTemplateRow[]
  templateItems: CircleCheckTemplateItemRow[]
}) {
  const activeFuelTypes = fuelTypes.filter((f) => f.is_active)
  const fuelById = new Map(fuelTypes.map((f) => [f.id, f]))
  const itemsByTemplate = new Map<string, CircleCheckTemplateItemRow[]>()
  for (const it of templateItems) {
    const arr = itemsByTemplate.get(it.template_id) ?? []
    arr.push(it)
    itemsByTemplate.set(it.template_id, arr)
  }
  // Fuel types not yet covered by a template — used to gate the create form.
  const usedFuelTypeIds = new Set(templates.map((t) => t.fuel_type_id))
  const availableFuelTypes = activeFuelTypes.filter(
    (f) => !usedFuelTypeIds.has(f.id),
  )
  const atCap = templates.length >= CIRCLE_CHECK_TEMPLATE_CAP

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Circle check templates ({templates.length} / {CIRCLE_CHECK_TEMPLATE_CAP})
        </CardTitle>
        <CardDescription>
          One template per fuel type. When an operator selects a resurfacer the
          matching template&apos;s checklist is shown.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {templates.length === 0 ? (
          <p className="text-muted-foreground text-sm">No templates yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {templates.map((tmpl) => (
              <TemplateRowItem
                key={tmpl.id}
                template={tmpl}
                fuelType={fuelById.get(tmpl.fuel_type_id) ?? null}
                fuelTypes={activeFuelTypes}
                items={itemsByTemplate.get(tmpl.id) ?? []}
              />
            ))}
          </ul>
        )}
        {atCap ? (
          <p className="text-muted-foreground text-xs">
            Reached the {CIRCLE_CHECK_TEMPLATE_CAP}-template cap. Delete a
            template to add a new one.
          </p>
        ) : availableFuelTypes.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {activeFuelTypes.length === 0
              ? "Add an active fuel type first, then create a template for it."
              : "Every active fuel type already has a template."}
          </p>
        ) : (
          <TemplateCreateForm fuelTypes={availableFuelTypes} />
        )}
      </CardContent>
    </Card>
  )
}

function TemplateRowItem({
  template,
  fuelType,
  fuelTypes,
  items,
}: {
  template: CircleCheckTemplateRow
  fuelType: FuelTypeRow | null
  fuelTypes: FuelTypeRow[]
  items: CircleCheckTemplateItemRow[]
}) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState(
    updateCircleCheckTemplate,
    NULL_STATE,
  )
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()
  const [fuelTypeId, setFuelTypeId] = useState<string>(template.fuel_type_id)

  // Allow keeping the current fuel type in the dropdown even if it's now
  // marked inactive (otherwise it'd silently disappear).
  const editableFuelTypes = fuelTypes.some((f) => f.id === template.fuel_type_id)
    ? fuelTypes
    : fuelType
      ? [fuelType, ...fuelTypes]
      : fuelTypes

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Template updated.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  function onToggleActive() {
    startActive(async () => {
      const r = await setCircleCheckTemplateActive(
        template.id,
        !template.is_active,
      )
      if (!r.ok) toast.error(r.error)
    })
  }
  function onDelete() {
    if (
      !confirm(
        `Delete template "${template.name}"? Its ${items.length} field(s) will also be deleted.`,
      )
    ) {
      return
    }
    startDel(async () => {
      const r = await deleteCircleCheckTemplate(template.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Template deleted.")
    })
  }

  return (
    <li className="bg-muted/30 flex flex-col gap-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{template.name}</span>
          {fuelType && (
            <Badge variant="outline" className="uppercase">
              {fuelType.name}
            </Badge>
          )}
          {!template.is_active && (
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
            {template.is_active ? "Deactivate" : "Activate"}
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
      {template.description && !editing && (
        <p className="text-muted-foreground text-xs">{template.description}</p>
      )}
      {editing && (
        <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={template.id} />
          <input type="hidden" name="fuel_type_id" value={fuelTypeId} />
          <div className="flex flex-col gap-1">
            <Label htmlFor={`tmpl-name-${template.id}`}>Name</Label>
            <Input
              id={`tmpl-name-${template.id}`}
              name="name"
              defaultValue={template.name}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`tmpl-fuel-${template.id}`}>Fuel type</Label>
            <Select
              value={fuelTypeId || undefined}
              onValueChange={(v) => setFuelTypeId(v)}
            >
              <SelectTrigger id={`tmpl-fuel-${template.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {editableFuelTypes.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor={`tmpl-desc-${template.id}`}>Description</Label>
            <Textarea
              id={`tmpl-desc-${template.id}`}
              name="description"
              rows={2}
              defaultValue={template.description ?? ""}
            />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      )}

      <TemplateItemsList templateId={template.id} items={items} />
    </li>
  )
}

function TemplateItemsList({
  templateId,
  items,
}: {
  templateId: string
  items: CircleCheckTemplateItemRow[]
}) {
  const router = useRouter()
  const importSchema: ImportSchema = useMemo(
    () => ({
      ...circleCheckTemplateItemsImportSpec,
      onImport: (rows) => importCircleCheckTemplateItems(templateId, rows),
    }),
    [templateId],
  )
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
          Checklist fields ({items.length})
        </h5>
        <BulkUploadPanel
          schema={importSchema}
          triggerLabel="Bulk upload fields"
          onImported={() => router.refresh()}
        />
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm italic">
          No fields yet. Add one below.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((it) => (
            <TemplateItemRow key={it.id} item={it} />
          ))}
        </ul>
      )}
      <TemplateItemCreateForm templateId={templateId} />
    </div>
  )
}

function TemplateItemRow({ item }: { item: CircleCheckTemplateItemRow }) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState(
    updateCircleCheckTemplateItem,
    NULL_STATE,
  )
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Field updated.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  function onToggleActive() {
    startActive(async () => {
      const r = await setCircleCheckTemplateItemActive(item.id, !item.is_active)
      if (!r.ok) toast.error(r.error)
    })
  }
  function onDelete() {
    if (!confirm(`Delete field "${item.label}"?`)) return
    startDel(async () => {
      const r = await deleteCircleCheckTemplateItem(item.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Field deleted.")
    })
  }

  return (
    <li className="bg-background flex flex-col gap-2 rounded-md border p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{item.label}</span>
          {!item.is_active && (
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
            {item.is_active ? "Deactivate" : "Activate"}
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
      {item.description && !editing && (
        <p className="text-muted-foreground text-xs">{item.description}</p>
      )}
      {editing && (
        <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={item.id} />
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor={`tmpli-label-${item.id}`}>Label</Label>
            <Input
              id={`tmpli-label-${item.id}`}
              name="label"
              defaultValue={item.label}
              required
            />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor={`tmpli-desc-${item.id}`}>Description</Label>
            <Textarea
              id={`tmpli-desc-${item.id}`}
              name="description"
              rows={2}
              defaultValue={item.description ?? ""}
            />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      )}
    </li>
  )
}

function TemplateItemCreateForm({ templateId }: { templateId: string }) {
  const [state, action, pending] = useActionState(
    createCircleCheckTemplateItem,
    NULL_STATE,
  )
  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Field added.")
    if (state.ok === false) toast.error(state.error)
  }, [state])
  return (
    <form
      action={action}
      className="grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-2"
      key={state.ok === true ? `tmpli-form-ok-${templateId}` : `tmpli-form-${templateId}`}
    >
      <input type="hidden" name="template_id" value={templateId} />
      <div className="flex flex-col gap-1 sm:col-span-2">
        <Label htmlFor={`new-tmpli-label-${templateId}`}>
          Add field — Label
        </Label>
        <Input
          id={`new-tmpli-label-${templateId}`}
          name="label"
          required
          placeholder="e.g. Battery charge level"
        />
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <Label htmlFor={`new-tmpli-desc-${templateId}`}>
          Description (optional)
        </Label>
        <Textarea
          id={`new-tmpli-desc-${templateId}`}
          name="description"
          rows={2}
        />
      </div>
      <div className="sm:col-span-2 flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add field"}
        </Button>
      </div>
    </form>
  )
}

function TemplateCreateForm({ fuelTypes }: { fuelTypes: FuelTypeRow[] }) {
  const [state, action, pending] = useActionState(
    createCircleCheckTemplate,
    NULL_STATE,
  )
  const [fuelTypeId, setFuelTypeId] = useState<string>("")

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Template created.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  return (
    <form
      action={action}
      className="grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-2"
      key={state.ok === true ? "tmpl-form-ok" : "tmpl-form"}
    >
      <input type="hidden" name="fuel_type_id" value={fuelTypeId} />
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-tmpl-name">Add template — Name</Label>
        <Input
          id="new-tmpl-name"
          name="name"
          required
          placeholder="e.g. Electric Resurfacer Daily Check"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-tmpl-fuel">Fuel type</Label>
        <Select
          value={fuelTypeId || undefined}
          onValueChange={(v) => setFuelTypeId(v)}
        >
          <SelectTrigger id="new-tmpl-fuel">
            <SelectValue placeholder="Select a fuel type" />
          </SelectTrigger>
          <SelectContent>
            {fuelTypes.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <Label htmlFor="new-tmpl-desc">Description (optional)</Label>
        <Textarea id="new-tmpl-desc" name="description" rows={2} />
      </div>
      <div className="sm:col-span-2 flex justify-end">
        <Button type="submit" size="sm" disabled={pending || !fuelTypeId}>
          {pending ? "Adding…" : "Add template"}
        </Button>
      </div>
    </form>
  )
}
