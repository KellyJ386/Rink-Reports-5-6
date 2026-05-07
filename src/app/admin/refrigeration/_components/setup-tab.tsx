"use client"

import Link from "next/link"
import { useActionState, useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

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
  createEquipment,
  createField,
  createSection,
  createThreshold,
  deleteEquipment,
  deleteField,
  deleteSection,
  deleteThreshold,
  moveField,
  setEquipmentActive,
  setFieldActive,
  setSectionActive,
  setThresholdActive,
  updateEquipment,
  updateField,
  updateSection,
  updateThreshold,
} from "../actions"
import type {
  ActionState,
  EquipmentRow,
  FieldRow,
  FieldType,
  SectionDetail,
  SectionRow,
  SectionWithCounts,
  SelectOption,
  Severity,
  ThresholdRow,
} from "../types"
import { FIELD_TYPES, SEVERITIES } from "../types"

import { SeedDefaultsCard } from "./seed-defaults-card"

const NULL_STATE: ActionState = { ok: null }

type Props = {
  sections: SectionWithCounts[]
  detail: SectionDetail | null
  activeSectionId: string | null
}

export function SetupTab({ sections, detail, activeSectionId }: Props) {
  if (sections.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <SeedDefaultsCard />
        <SectionCreateCard />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[18rem_1fr]">
      <div className="flex flex-col gap-3">
        <SectionsList
          sections={sections}
          activeSectionId={activeSectionId}
        />
        <SectionCreateCard />
      </div>
      <div>
        {detail ? (
          <SectionDetailPane detail={detail} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Pick a section</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm">
                Select a section from the list to manage equipment, fields, and
                thresholds.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sections — list + create
// ---------------------------------------------------------------------------

function SectionsList({
  sections,
  activeSectionId,
}: {
  sections: SectionWithCounts[]
  activeSectionId: string | null
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sections</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 p-2">
        {sections.map((s) => (
          <Link
            key={s.id}
            href={`/admin/refrigeration?tab=setup&section=${s.id}`}
            className={cn(
              "flex flex-col gap-0.5 rounded-md px-3 py-2 text-sm transition-colors",
              activeSectionId === s.id
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{s.name}</span>
              {!s.is_active && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase",
                    activeSectionId === s.id
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
                activeSectionId === s.id
                  ? "text-primary-foreground/80"
                  : "text-muted-foreground",
              )}
            >
              {s.equipment_count} equipment, {s.field_count} fields
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}

function SectionCreateCard() {
  const [state, action, pending] = useActionState(createSection, NULL_STATE)
  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Section created.")
    if (state.ok === false) toast.error(state.error)
  }, [state])
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add section</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-section-name">Name</Label>
            <Input id="new-section-name" name="name" required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-section-slug">
              Slug{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Input
              id="new-section-slug"
              name="slug"
              placeholder="auto-generated from name"
            />
          </div>
          <Button type="submit" disabled={pending} size="sm">
            {pending ? "Adding…" : "Add section"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section detail pane
// ---------------------------------------------------------------------------

function SectionDetailPane({ detail }: { detail: SectionDetail }) {
  const { section, equipment, fields, thresholds } = detail
  const sectionLevelFields = fields.filter((f) => f.equipment_id === null)
  const equipmentFields = (equipId: string) =>
    fields.filter((f) => f.equipment_id === equipId)

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader section={section} />
      <EquipmentBlock sectionId={section.id} equipment={equipment} />
      <FieldsBlock
        title="Section-level fields"
        description="Fields not tied to a specific piece of equipment."
        fields={sectionLevelFields}
        sectionId={section.id}
        equipmentId={null}
        equipment={equipment}
        thresholds={thresholds}
      />
      {equipment.map((eq) => (
        <FieldsBlock
          key={eq.id}
          title={`Fields for ${eq.name}`}
          description={null}
          fields={equipmentFields(eq.id)}
          sectionId={section.id}
          equipmentId={eq.id}
          equipment={equipment}
          thresholds={thresholds}
        />
      ))}
    </div>
  )
}

function SectionHeader({ section }: { section: SectionRow }) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState(updateSection, NULL_STATE)
  const [activePending, startActiveTransition] = useTransition()
  const [delPending, startDelTransition] = useTransition()

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Section updated.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  function onToggleActive() {
    startActiveTransition(async () => {
      const r = await setSectionActive(section.id, !section.is_active)
      if (!r.ok) toast.error(r.error)
    })
  }

  function onDelete() {
    if (
      !confirm(
        "Delete this section? This will fail if equipment, fields, or reports reference it. Deactivate instead if needed.",
      )
    ) {
      return
    }
    startDelTransition(async () => {
      const r = await deleteSection(section.id)
      if (!r.ok) toast.error(r.error)
      else {
        toast.success("Section deleted.")
        window.location.href = "/admin/refrigeration?tab=setup"
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            {section.name}
            {!section.is_active && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium uppercase">
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
              {section.is_active ? "Deactivate" : "Activate"}
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
            <input type="hidden" name="id" value={section.id} />
            <div className="flex flex-col gap-1">
              <Label htmlFor={`sec-name-${section.id}`}>Name</Label>
              <Input
                id={`sec-name-${section.id}`}
                name="name"
                defaultValue={section.name}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`sec-slug-${section.id}`}>Slug</Label>
              <Input
                id={`sec-slug-${section.id}`}
                name="slug"
                defaultValue={section.slug}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`sec-sort-${section.id}`}>Sort</Label>
              <Input
                id={`sec-sort-${section.id}`}
                name="sort_order"
                type="number"
                defaultValue={section.sort_order}
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
// Equipment block
// ---------------------------------------------------------------------------

function EquipmentBlock({
  sectionId,
  equipment,
}: {
  sectionId: string
  equipment: EquipmentRow[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Equipment ({equipment.length})</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {equipment.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No equipment yet for this section.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {equipment.map((eq) => (
              <EquipmentRowItem key={eq.id} equipment={eq} />
            ))}
          </ul>
        )}
        <EquipmentCreateForm sectionId={sectionId} />
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
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{equipment.name}</span>
          <span className="text-muted-foreground text-xs">
            ({equipment.slug})
          </span>
          {!equipment.is_active && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase">
              off
            </span>
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

function EquipmentCreateForm({ sectionId }: { sectionId: string }) {
  const [state, action, pending] = useActionState(createEquipment, NULL_STATE)
  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Equipment created.")
    if (state.ok === false) toast.error(state.error)
  }, [state])
  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-3 rounded-md border p-3"
    >
      <input type="hidden" name="section_id" value={sectionId} />
      <div className="flex flex-col gap-1">
        <Label htmlFor={`new-eq-name-${sectionId}`}>New equipment</Label>
        <Input
          id={`new-eq-name-${sectionId}`}
          name="name"
          required
          placeholder="e.g. Compressor 1"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`new-eq-slug-${sectionId}`}>Slug (optional)</Label>
        <Input id={`new-eq-slug-${sectionId}`} name="slug" />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "Add equipment"}
      </Button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Fields block (per section / per equipment)
// ---------------------------------------------------------------------------

function FieldsBlock({
  title,
  description,
  fields,
  sectionId,
  equipmentId,
  equipment,
  thresholds,
}: {
  title: string
  description: string | null
  fields: FieldRow[]
  sectionId: string
  equipmentId: string | null
  equipment: EquipmentRow[]
  thresholds: ThresholdRow[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {title} ({fields.length})
        </CardTitle>
        {description && (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {fields.length === 0 ? (
          <p className="text-muted-foreground text-sm">No fields yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {fields.map((f) => (
              <FieldRowItem
                key={f.id}
                field={f}
                equipment={equipment}
                thresholds={thresholds.filter((t) => t.field_id === f.id)}
              />
            ))}
          </ul>
        )}
        <FieldCreateForm sectionId={sectionId} equipmentId={equipmentId} />
      </CardContent>
    </Card>
  )
}

function readOptions(field: FieldRow): SelectOption[] {
  if (!Array.isArray(field.options)) return []
  return (field.options as unknown[])
    .filter(
      (o): o is { key: string; label: string } =>
        typeof o === "object" &&
        o !== null &&
        typeof (o as { key?: unknown }).key === "string" &&
        typeof (o as { label?: unknown }).label === "string",
    )
    .map((o) => ({ key: o.key, label: o.label }))
}

function optionsToText(opts: SelectOption[]): string {
  return opts.map((o) => `${o.key}|${o.label}`).join("\n")
}

function FieldRowItem({
  field,
  equipment,
  thresholds,
}: {
  field: FieldRow
  equipment: EquipmentRow[]
  thresholds: ThresholdRow[]
}) {
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [state, action, pending] = useActionState(updateField, NULL_STATE)
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()
  const [movePending, startMove] = useTransition()
  const [fieldType, setFieldType] = useState<FieldType>(
    field.field_type as FieldType,
  )

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Field updated.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  function onToggleActive() {
    startActive(async () => {
      const r = await setFieldActive(field.id, !field.is_active)
      if (!r.ok) toast.error(r.error)
    })
  }
  function onDelete() {
    if (!confirm(`Delete field "${field.label}"?`)) return
    startDel(async () => {
      const r = await deleteField(field.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Field deleted.")
    })
  }
  function onMove(dir: -1 | 1) {
    startMove(async () => {
      const r = await moveField(field.id, dir)
      if (!r.ok) toast.error(r.error)
    })
  }

  const opts = readOptions(field)

  return (
    <li className="bg-muted/30 flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{field.label}</span>
          <span className="text-muted-foreground text-xs">
            ({field.field_type}
            {field.unit ? `, ${field.unit}` : ""})
          </span>
          {!field.is_active && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase">
              off
            </span>
          )}
          {thresholds.length > 0 && (
            <span className="rounded-full bg-secondary text-secondary-foreground px-1.5 py-0.5 text-[10px] font-medium">
              {thresholds.length} threshold{thresholds.length === 1 ? "" : "s"}
            </span>
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
            {field.is_active ? "Deactivate" : "Activate"}
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
          <input type="hidden" name="id" value={field.id} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`f-label-${field.id}`}>Label</Label>
              <Input
                id={`f-label-${field.id}`}
                name="label"
                defaultValue={field.label}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`f-key-${field.id}`}>Key</Label>
              <Input
                id={`f-key-${field.id}`}
                name="key"
                defaultValue={field.key}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`f-type-${field.id}`}>Type</Label>
              <select
                id={`f-type-${field.id}`}
                name="field_type"
                value={fieldType}
                onChange={(e) => setFieldType(e.target.value as FieldType)}
                className="border-input bg-transparent h-9 rounded-md border px-3 text-sm shadow-xs"
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`f-unit-${field.id}`}>Unit</Label>
              <Input
                id={`f-unit-${field.id}`}
                name="unit"
                defaultValue={field.unit ?? ""}
                placeholder="e.g. psi, °F"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`f-sort-${field.id}`}>Sort</Label>
              <Input
                id={`f-sort-${field.id}`}
                name="sort_order"
                type="number"
                defaultValue={field.sort_order}
                className="w-24"
              />
            </div>
          </div>
          {fieldType === "select" && (
            <div className="flex flex-col gap-1">
              <Label htmlFor={`f-opts-${field.id}`}>
                Options (one per line: <code>key|Label</code>)
              </Label>
              <Textarea
                id={`f-opts-${field.id}`}
                name="options"
                rows={3}
                defaultValue={optionsToText(opts)}
                placeholder={"on|On\noff|Off"}
              />
            </div>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save field"}
            </Button>
          </div>
        </form>
      )}

      {expanded && (
        <div className="border-t pt-3">
          <ThresholdsBlock
            field={field}
            equipment={equipment}
            thresholds={thresholds}
          />
        </div>
      )}
    </li>
  )
}

function FieldCreateForm({
  sectionId,
  equipmentId,
}: {
  sectionId: string
  equipmentId: string | null
}) {
  const [state, action, pending] = useActionState(createField, NULL_STATE)
  const [fieldType, setFieldType] = useState<FieldType>("numeric")
  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Field created.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  return (
    <form
      action={action}
      className="flex flex-col gap-3 rounded-md border p-3"
    >
      <input type="hidden" name="section_id" value={sectionId} />
      {equipmentId && (
        <input type="hidden" name="equipment_id" value={equipmentId} />
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label
            htmlFor={`new-f-label-${sectionId}-${equipmentId ?? "section"}`}
          >
            Add field — Label
          </Label>
          <Input
            id={`new-f-label-${sectionId}-${equipmentId ?? "section"}`}
            name="label"
            required
            placeholder="e.g. Suction pressure"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label
            htmlFor={`new-f-key-${sectionId}-${equipmentId ?? "section"}`}
          >
            Key (optional)
          </Label>
          <Input
            id={`new-f-key-${sectionId}-${equipmentId ?? "section"}`}
            name="key"
            placeholder="auto from label"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label
            htmlFor={`new-f-type-${sectionId}-${equipmentId ?? "section"}`}
          >
            Type
          </Label>
          <select
            id={`new-f-type-${sectionId}-${equipmentId ?? "section"}`}
            name="field_type"
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as FieldType)}
            className="border-input bg-transparent h-9 rounded-md border px-3 text-sm shadow-xs"
          >
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label
            htmlFor={`new-f-unit-${sectionId}-${equipmentId ?? "section"}`}
          >
            Unit (optional)
          </Label>
          <Input
            id={`new-f-unit-${sectionId}-${equipmentId ?? "section"}`}
            name="unit"
            placeholder="e.g. psi"
          />
        </div>
      </div>
      {fieldType === "select" && (
        <div className="flex flex-col gap-1">
          <Label
            htmlFor={`new-f-opts-${sectionId}-${equipmentId ?? "section"}`}
          >
            Options (one per line: <code>key|Label</code>)
          </Label>
          <Textarea
            id={`new-f-opts-${sectionId}-${equipmentId ?? "section"}`}
            name="options"
            rows={3}
            placeholder={"on|On\noff|Off"}
          />
        </div>
      )}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add field"}
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Thresholds block (inline under a field)
// ---------------------------------------------------------------------------

function ThresholdsBlock({
  field,
  equipment,
  thresholds,
}: {
  field: FieldRow
  equipment: EquipmentRow[]
  thresholds: ThresholdRow[]
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
            <ThresholdRowItem key={t.id} threshold={t} equipment={equipment} />
          ))}
        </ul>
      )}
      <ThresholdCreateForm field={field} equipment={equipment} />
    </div>
  )
}

function severityBadgeClass(sev: Severity): string {
  if (sev === "critical")
    return "bg-destructive/15 text-destructive border-destructive/30"
  if (sev === "high")
    return "bg-orange-500/15 text-orange-700 border-orange-500/30 dark:text-orange-300"
  return "bg-yellow-500/15 text-yellow-700 border-yellow-500/30 dark:text-yellow-300"
}

function ThresholdRowItem({
  threshold,
  equipment,
}: {
  threshold: ThresholdRow
  equipment: EquipmentRow[]
}) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState(updateThreshold, NULL_STATE)
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()
  const sev = threshold.severity as Severity

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

  const equipmentName =
    threshold.equipment_id === null
      ? "All equipment"
      : (equipment.find((e) => e.id === threshold.equipment_id)?.name ??
        "Unknown")

  return (
    <li className="bg-background flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{equipmentName}</span>
          <span className="text-muted-foreground">
            min={threshold.min_value ?? "—"} / max={threshold.max_value ?? "—"}
          </span>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase",
              severityBadgeClass(sev),
            )}
          >
            {sev}
          </span>
          {!threshold.is_active && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase">
              off
            </span>
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
      {editing && (
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={threshold.id} />
          <div className="flex flex-col gap-1">
            <Label htmlFor={`th-min-${threshold.id}`}>Min</Label>
            <Input
              id={`th-min-${threshold.id}`}
              name="min_value"
              type="number"
              step="any"
              defaultValue={threshold.min_value ?? ""}
              className="w-28"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`th-max-${threshold.id}`}>Max</Label>
            <Input
              id={`th-max-${threshold.id}`}
              name="max_value"
              type="number"
              step="any"
              defaultValue={threshold.max_value ?? ""}
              className="w-28"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`th-sev-${threshold.id}`}>Severity</Label>
            <select
              id={`th-sev-${threshold.id}`}
              name="severity"
              defaultValue={sev}
              className="border-input bg-transparent h-9 rounded-md border px-3 text-sm shadow-xs"
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      )}
    </li>
  )
}

function ThresholdCreateForm({
  field,
  equipment,
}: {
  field: FieldRow
  equipment: EquipmentRow[]
}) {
  const [state, action, pending] = useActionState(createThreshold, NULL_STATE)
  useEffect(() => {
    if (state.ok === true)
      toast.success(state.message ?? "Threshold created.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  // Equipment scope only makes sense if the field is section-level. If the
  // field is already pinned to a specific piece of equipment, scope is forced
  // to that equipment (or to "All for this field" when null).
  const isSectionLevel = field.equipment_id === null

  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-3 rounded-md border p-3"
    >
      <input type="hidden" name="field_id" value={field.id} />
      {!isSectionLevel && field.equipment_id && (
        <input type="hidden" name="equipment_id" value={field.equipment_id} />
      )}
      {isSectionLevel && (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`new-th-eq-${field.id}`}>Scope</Label>
          <select
            id={`new-th-eq-${field.id}`}
            name="equipment_id"
            className="border-input bg-transparent h-9 rounded-md border px-3 text-sm shadow-xs"
          >
            <option value="">All equipment</option>
            {equipment.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor={`new-th-min-${field.id}`}>Min</Label>
        <Input
          id={`new-th-min-${field.id}`}
          name="min_value"
          type="number"
          step="any"
          className="w-28"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`new-th-max-${field.id}`}>Max</Label>
        <Input
          id={`new-th-max-${field.id}`}
          name="max_value"
          type="number"
          step="any"
          className="w-28"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`new-th-sev-${field.id}`}>Severity</Label>
        <select
          id={`new-th-sev-${field.id}`}
          name="severity"
          defaultValue="warn"
          className="border-input bg-transparent h-9 rounded-md border px-3 text-sm shadow-xs"
        >
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "Add threshold"}
      </Button>
    </form>
  )
}
