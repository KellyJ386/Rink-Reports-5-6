"use client"

// The form-builder editor sheet: define/reorder/remove fields, preview the
// exact staff rendering, and save — as version 1 for a new form, or as a NEW
// version (publish) when editing an existing one. Field edits never touch the
// published version's rows; the whole field list is re-submitted and the
// server inserts it under the new version row.

import { useMemo, useState, useTransition } from "react"
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RequiredMark } from "@/components/ui/required-mark"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

import {
  FIELD_TYPES,
  type FieldType,
  type TemplateSnapshot,
} from "@/app/reports/daily/_lib/instance-compute"
import { SnapshotFieldInput } from "@/app/reports/daily/forms/_components/snapshot-field-input"

import {
  createFormTemplate,
  publishFormTemplateVersion,
} from "../form-template-actions"
import type { FormFieldRow, FormTemplateRow } from "../types"

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  textarea: "Long text",
  number: "Number",
  select: "Dropdown",
  multiselect: "Multi-select",
  checkbox: "Checkbox",
  time: "Time",
  date: "Date",
}

type DraftField = {
  key: string
  label: string
  field_type: FieldType
  optionsText: string
  required: boolean
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  areaId: string
  areaName: string
  editing: FormTemplateRow | null
  editingFields: FormFieldRow[]
}

export function FormBuilderEditor(props: Props) {
  const formKey = props.editing
    ? `edit:${props.editing.id}`
    : `new:${props.areaId}`
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-2xl"
      >
        <EditorBody key={formKey} {...props} />
      </SheetContent>
    </Sheet>
  )
}

let nextKey = 0
function newKey(): string {
  nextKey += 1
  return `f${nextKey}`
}

function fromRows(rows: FormFieldRow[]): DraftField[] {
  return rows.map((r) => ({
    key: newKey(),
    label: r.label,
    field_type: r.field_type as FieldType,
    optionsText: Array.isArray(r.options)
      ? (r.options as string[]).join("\n")
      : "",
    required: r.required,
  }))
}

function needsOptions(t: FieldType): boolean {
  return t === "select" || t === "multiselect"
}

function toPayload(fields: DraftField[]) {
  return fields.map((f) => ({
    label: f.label,
    field_type: f.field_type,
    options: needsOptions(f.field_type)
      ? f.optionsText
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : null,
    required: f.required,
  }))
}

function EditorBody({
  onOpenChange,
  areaId,
  areaName,
  editing,
  editingFields,
}: Props) {
  const isEdit = editing !== null
  const [name, setName] = useState(editing?.name ?? "")
  const [fields, setFields] = useState<DraftField[]>(() =>
    isEdit
      ? fromRows(editingFields)
      : [
          {
            key: newKey(),
            label: "",
            field_type: "text",
            optionsText: "",
            required: false,
          },
        ],
  )
  const [showPreview, setShowPreview] = useState(false)
  const [pending, startTransition] = useTransition()

  function patchField(key: string, patch: Partial<DraftField>) {
    setFields((prev) =>
      prev.map((f) => (f.key === key ? { ...f, ...patch } : f)),
    )
  }

  function moveField(key: string, direction: -1 | 1) {
    setFields((prev) => {
      const i = prev.findIndex((f) => f.key === key)
      const j = i + direction
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function removeField(key: string) {
    setFields((prev) => prev.filter((f) => f.key !== key))
  }

  function addField() {
    setFields((prev) => [
      ...prev,
      {
        key: newKey(),
        label: "",
        field_type: "text",
        optionsText: "",
        required: false,
      },
    ])
  }

  // Synthesized snapshot so the preview IS the staff rendering.
  const previewSnapshot: TemplateSnapshot = useMemo(
    () => ({
      template_id: "preview",
      template_name: name || "Untitled form",
      version: (editing?.version ?? 0) + 1,
      fields: fields.map((f, i) => ({
        id: f.key,
        label: f.label || `Field ${i + 1}`,
        field_type: f.field_type,
        options: needsOptions(f.field_type)
          ? f.optionsText
              .split("\n")
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          : null,
        required: f.required,
        sort_order: i,
      })),
    }),
    [name, fields, editing],
  )

  function save() {
    startTransition(async () => {
      const payload = toPayload(fields)
      const result = isEdit
        ? await publishFormTemplateVersion({
            templateId: editing.id,
            name,
            fields: payload,
          })
        : await createFormTemplate({ areaId, name, fields: payload })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(
        isEdit
          ? `Published version ${result.version}. Existing reports keep the old form.`
          : "Form created.",
      )
      onOpenChange(false)
    })
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {isEdit ? `Edit form (v${editing.version})` : `New form · ${areaName}`}
        </SheetTitle>
        <SheetDescription>
          {isEdit
            ? "Saving publishes a NEW version of this form. Reports already filed keep rendering the version they were created with."
            : "Staff will be able to file multiple titled reports per day against this form."}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="form-name">
            Form name
            <RequiredMark />
          </Label>
          <Input
            id="form-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Event Set Up"
            maxLength={200}
          />
        </div>

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Fields</h3>
          <label className="flex items-center gap-2 text-sm font-medium">
            Preview
            <Switch
              checked={showPreview}
              onCheckedChange={setShowPreview}
              aria-label="Toggle preview"
            />
          </label>
        </div>

        {showPreview ? (
          <div className="rounded-xl border p-4">
            <p className="text-muted-foreground mb-3 text-sm font-semibold">
              {previewSnapshot.template_name} — staff preview
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {previewSnapshot.fields.map((field) => (
                <SnapshotFieldInput
                  key={field.id}
                  field={field}
                  value={undefined}
                  onChange={() => {}}
                  idPrefix="preview"
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {fields.map((f, i) => (
              <div key={f.key} className="flex flex-col gap-3 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground text-xs font-semibold">
                    Field {i + 1}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => moveField(f.key, -1)}
                      disabled={i === 0}
                      aria-label="Move up"
                    >
                      <ArrowUp className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => moveField(f.key, 1)}
                      disabled={i === fields.length - 1}
                      aria-label="Move down"
                    >
                      <ArrowDown className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeField(f.key)}
                      disabled={fields.length === 1}
                      aria-label="Remove field"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`label-${f.key}`}>
                      Label
                      <RequiredMark />
                    </Label>
                    <Input
                      id={`label-${f.key}`}
                      value={f.label}
                      onChange={(e) =>
                        patchField(f.key, { label: e.target.value })
                      }
                      placeholder="Event name"
                      maxLength={200}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`type-${f.key}`}>Type</Label>
                    <Select
                      value={f.field_type}
                      onValueChange={(v) =>
                        patchField(f.key, { field_type: v as FieldType })
                      }
                    >
                      <SelectTrigger id={`type-${f.key}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FIELD_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {FIELD_TYPE_LABELS[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {needsOptions(f.field_type) && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`options-${f.key}`}>
                      Options (one per line)
                      <RequiredMark />
                    </Label>
                    <Textarea
                      id={`options-${f.key}`}
                      rows={3}
                      value={f.optionsText}
                      onChange={(e) =>
                        patchField(f.key, { optionsText: e.target.value })
                      }
                      placeholder={"North rink\nSouth rink"}
                    />
                  </div>
                )}

                <label className="flex items-center gap-2 text-sm font-medium">
                  <Switch
                    checked={f.required}
                    onCheckedChange={(v) => patchField(f.key, { required: v })}
                    aria-label={`Field ${i + 1} required`}
                  />
                  Required
                </label>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              onClick={addField}
              className="self-start"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add field
            </Button>
          </div>
        )}

        <div className="mt-2 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={pending}>
            {pending
              ? "Saving…"
              : isEdit
                ? `Publish as v${(editing?.version ?? 0) + 1}`
                : "Create form"}
          </Button>
        </div>
      </div>
    </>
  )
}
