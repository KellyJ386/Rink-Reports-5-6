"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
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

import type { ActionState } from "../../types"
import {
  createCustomField,
  deleteCustomField,
  updateCustomField,
} from "../actions"

export type CustomFieldRow = {
  id: string
  facility_id: string
  key: string
  label: string
  field_type: "text" | "number" | "date" | "boolean"
  is_required: boolean
  sort_order: number
  is_active: boolean
}

type Props = {
  facilityId: string
  fields: CustomFieldRow[]
}

const INITIAL: ActionState = { ok: null }

const FIELD_TYPE_LABELS: Record<CustomFieldRow["field_type"], string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  boolean: "Yes / No",
}

export function CustomFieldsClient({ facilityId, fields }: Props) {
  const [editing, setEditing] = useState<CustomFieldRow | null>(null)
  const [showForm, setShowForm] = useState(false)
  const router = useRouter()

  function openNew() {
    setEditing(null)
    setShowForm(true)
  }

  function openEdit(f: CustomFieldRow) {
    setEditing(f)
    setShowForm(true)
  }

  async function onDelete(f: CustomFieldRow) {
    if (
      !confirm(
        `Delete "${f.label}"? Any stored values on employees for this field will be removed.`,
      )
    ) {
      return
    }
    const res = await deleteCustomField(f.id)
    if (res.ok === true) {
      toast.success("Field deleted.")
      router.refresh()
    } else if (res.ok === false) {
      toast.error(res.error)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {fields.length} field{fields.length === 1 ? "" : "s"}
        </p>
        <Button onClick={openNew}>Add field</Button>
      </div>

      {showForm ? (
        <FieldForm
          key={editing ? `edit:${editing.id}` : "new"}
          facilityId={facilityId}
          editing={editing}
          onDone={() => {
            setShowForm(false)
            setEditing(null)
            router.refresh()
          }}
          onCancel={() => {
            setShowForm(false)
            setEditing(null)
          }}
        />
      ) : null}

      {fields.length === 0 ? (
        <div className="rounded-md border p-8 text-center">
          <p className="text-base font-medium">No custom fields yet.</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Add a field to make it appear on the employee form.
          </p>
        </div>
      ) : (
        <div className="overflow-auto rounded-md border">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/60">
              <tr className="text-left">
                <th className="border-b px-3 py-2 font-medium">Label</th>
                <th className="border-b px-3 py-2 font-medium">Key</th>
                <th className="border-b px-3 py-2 font-medium">Type</th>
                <th className="border-b px-3 py-2 font-medium">Required</th>
                <th className="border-b px-3 py-2 font-medium">Status</th>
                <th className="border-b px-3 py-2 font-medium">Sort</th>
                <th className="border-b px-3 py-2 text-right font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.id} className="hover:bg-muted/30">
                  <td className="border-b px-3 py-2 font-medium">{f.label}</td>
                  <td className="border-b px-3 py-2">
                    <code className="text-xs">{f.key}</code>
                  </td>
                  <td className="border-b px-3 py-2">
                    {FIELD_TYPE_LABELS[f.field_type]}
                  </td>
                  <td className="border-b px-3 py-2">
                    {f.is_required ? "Yes" : "No"}
                  </td>
                  <td
                    className={cn(
                      "border-b px-3 py-2",
                      f.is_active ? "" : "text-muted-foreground",
                    )}
                  >
                    {f.is_active ? "Active" : "Inactive"}
                  </td>
                  <td className="border-b px-3 py-2 tabular-nums">
                    {f.sort_order}
                  </td>
                  <td className="border-b px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(f)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => onDelete(f)}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function FieldForm({
  facilityId,
  editing,
  onDone,
  onCancel,
}: {
  facilityId: string
  editing: CustomFieldRow | null
  onDone: () => void
  onCancel: () => void
}) {
  const isEdit = editing !== null
  const [createState, createAction, createPending] = useActionState(
    createCustomField,
    INITIAL,
  )
  const [updateState, updateAction, updatePending] = useActionState(
    updateCustomField,
    INITIAL,
  )
  const state = isEdit ? updateState : createState
  const action = isEdit ? updateAction : createAction
  const pending = isEdit ? updatePending : createPending

  const [fieldType, setFieldType] = useState<CustomFieldRow["field_type"]>(
    editing?.field_type ?? "text",
  )

  useEffect(() => {
    if (state && "ok" in state && state.ok === true) {
      toast.success(state.message ?? "Saved.")
      onDone()
    }
  }, [state, onDone])

  const errorMsg =
    state && "ok" in state && state.ok === false ? state.error : null

  return (
    <form
      action={action}
      className="bg-card flex flex-col gap-3 rounded-md border p-4"
    >
      <input type="hidden" name="facility_id" value={facilityId} />
      {isEdit && editing ? (
        <input type="hidden" name="id" value={editing.id} />
      ) : null}
      <input type="hidden" name="field_type" value={fieldType} />

      <h3 className="text-base font-semibold">
        {isEdit ? `Edit "${editing!.label}"` : "Add custom field"}
      </h3>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cf-label">Label *</Label>
          <Input
            id="cf-label"
            name="label"
            required
            defaultValue={editing?.label ?? ""}
            placeholder="Locker number"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cf-key">Key *</Label>
          <Input
            id="cf-key"
            name="key"
            required
            defaultValue={editing?.key ?? ""}
            placeholder="locker_number"
            pattern="^[a-z][a-z0-9_]{0,62}$"
            title="Lowercase letters, digits, underscores. Start with a letter."
            readOnly={isEdit}
            className={isEdit ? "bg-muted" : undefined}
          />
          {isEdit ? (
            <p className="text-muted-foreground text-xs">
              Keys are stable once created. Delete & re-add to rename.
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cf-field-type">Type *</Label>
          <Select
            value={fieldType}
            onValueChange={(v) =>
              setFieldType(v as CustomFieldRow["field_type"])
            }
          >
            <SelectTrigger id="cf-field-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["text", "number", "date", "boolean"] as const).map((t) => (
                <SelectItem key={t} value={t}>
                  {FIELD_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cf-sort">Sort order</Label>
          <Input
            id="cf-sort"
            name="sort_order"
            type="number"
            defaultValue={editing?.sort_order ?? 0}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="is_required"
            defaultChecked={editing?.is_required ?? false}
            className="border-input size-4 rounded border"
          />
          Required on the employee form
        </label>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={editing?.is_active ?? true}
            className="border-input size-4 rounded border"
          />
          Active (renders on form)
        </label>
      </div>

      {errorMsg ? (
        <p role="alert" className="text-destructive text-sm">
          {errorMsg}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : isEdit ? "Save changes" : "Create field"}
        </Button>
      </div>
    </form>
  )
}
