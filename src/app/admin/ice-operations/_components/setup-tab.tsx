"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import {
  bulkAddCircleCheckItems,
  createCircleCheckItem,
  createEquipment,
  createRink,
  deleteCircleCheckItem,
  deleteEquipment,
  deleteRink,
  moveCircleCheckItem,
  setCircleCheckItemActive,
  setEquipmentActive,
  setRinkActive,
  updateCircleCheckItem,
  updateEquipment,
  updateRink,
} from "../actions"
import type {
  ActionState,
  CircleCheckItemRow,
  EquipmentRow,
  EquipmentType,
  RinkRow,
} from "../types"
import {
  CIRCLE_CHECK_BULK_CAP,
  EQUIPMENT_TYPES,
  equipmentTypeLabel,
} from "../types"

import { SeedDefaultsCard } from "./seed-defaults-card"

const NULL_STATE: ActionState = { ok: null }

type Props = {
  rinks: RinkRow[]
  equipment: EquipmentRow[]
  circleCheckItems: CircleCheckItemRow[]
}

export function SetupTab({ rinks, equipment, circleCheckItems }: Props) {
  const showSeed = rinks.length === 0 && circleCheckItems.length === 0

  return (
    <div className="flex flex-col gap-6">
      {showSeed && <SeedDefaultsCard />}
      <RinksCard rinks={rinks} />
      <EquipmentCard equipment={equipment} />
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

function EquipmentCard({ equipment }: { equipment: EquipmentRow[] }) {
  const groups = new Map<EquipmentType, EquipmentRow[]>()
  for (const t of EQUIPMENT_TYPES) groups.set(t.key, [])
  for (const eq of equipment) {
    const k = (
      EQUIPMENT_TYPES.find((t) => t.key === eq.equipment_type)?.key ?? "other"
    ) as EquipmentType
    groups.get(k)?.push(eq)
  }

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
                    <EquipmentRowItem key={eq.id} equipment={eq} />
                  ))}
                </ul>
              )}
            </div>
          )
        })}
        <EquipmentCreateForm />
      </CardContent>
    </Card>
  )
}

function EquipmentRowItem({ equipment }: { equipment: EquipmentRow }) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState(updateEquipment, NULL_STATE)
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()
  const [equipmentType, setEquipmentType] = useState(equipment.equipment_type)

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

function EquipmentCreateForm() {
  const [state, action, pending] = useActionState(createEquipment, NULL_STATE)
  const [newEqType, setNewEqType] = useState<EquipmentType>("zamboni")

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
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-eq-name">Add equipment — Name</Label>
        <Input id="new-eq-name" name="name" required placeholder="e.g. Zamboni 1" />
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
  const [bulkOpen, setBulkOpen] = useState(false)
  const total = items.length

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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBulkOpen((v) => !v)}
          >
            {bulkOpen ? "Cancel bulk" : "Bulk add"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {bulkOpen && (
          <BulkAddForm
            existingCount={total}
            onClose={() => setBulkOpen(false)}
          />
        )}
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

function BulkAddForm({
  existingCount,
  onClose,
}: {
  existingCount: number
  onClose: () => void
}) {
  const [text, setText] = useState("")
  const [pending, startTransition] = useTransition()

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const newCount = lines.length
  const remaining = CIRCLE_CHECK_BULK_CAP - existingCount
  const total = existingCount + newCount
  const overCap = total > CIRCLE_CHECK_BULK_CAP
  const overBatch = newCount > CIRCLE_CHECK_BULK_CAP

  function onSubmit() {
    if (newCount === 0) {
      toast.error("Paste at least one line.")
      return
    }
    if (overCap || overBatch) {
      toast.error(
        overBatch
          ? `Batch is over the ${CIRCLE_CHECK_BULK_CAP}-line cap.`
          : `Total would be ${total}; cap is ${CIRCLE_CHECK_BULK_CAP}.`,
      )
      return
    }
    startTransition(async () => {
      const r = await bulkAddCircleCheckItems(lines)
      if (!r.ok) {
        toast.error(r.error)
      } else {
        toast.success(`Added ${newCount} items.`)
        setText("")
        onClose()
      }
    })
  }

  return (
    <div className="bg-background flex flex-col gap-2 rounded-md border p-3">
      <Label htmlFor="bulk-cci">Bulk add (one item per line)</Label>
      <Textarea
        id="bulk-cci"
        rows={6}
        placeholder={"Tires OK\nHydraulic fluid OK\nBlade sharp\n…"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span
          className={cn(
            "text-muted-foreground",
            overCap || overBatch ? "text-destructive" : "",
          )}
        >
          {newCount} new · {existingCount} existing · {remaining} remaining
          (cap {CIRCLE_CHECK_BULK_CAP})
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setText("")
              onClose()
            }}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSubmit}
            disabled={pending || newCount === 0 || overCap || overBatch}
          >
            {pending ? "Adding…" : `Add ${newCount} items`}
          </Button>
        </div>
      </div>
    </div>
  )
}
