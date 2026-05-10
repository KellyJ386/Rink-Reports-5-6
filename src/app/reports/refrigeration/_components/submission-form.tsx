"use client"

import { useEffect, useMemo, useState } from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
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
import { Textarea } from "@/components/ui/textarea"

import {
  submitRefrigerationReport,
  type SubmissionFormState,
} from "../actions"
import type {
  RefrigerationFieldOption,
  RefrigerationFieldType,
  SubmittedFieldValue,
} from "../types"

type FieldDef = {
  id: string
  equipment_id: string | null
  label: string
  field_type: RefrigerationFieldType
  unit: string | null
  options: RefrigerationFieldOption[]
}

type EquipmentGroup = {
  id: string
  name: string
  fields: FieldDef[]
}

type SectionDef = {
  id: string
  name: string
  sectionLevelFields: FieldDef[]
  equipment: EquipmentGroup[]
}

type Props = {
  sections: SectionDef[]
  oorAlertsEnabled: boolean
}

const initialState: SubmissionFormState = {}

type RawValue = {
  text: string
  bool: boolean
}

function fieldKey(fieldId: string, equipmentId: string | null): string {
  return equipmentId ? `${fieldId}::${equipmentId}` : `${fieldId}::null`
}

export function SubmissionForm({ sections, oorAlertsEnabled }: Props) {
  const [state, formAction] = useActionState(
    submitRefrigerationReport,
    initialState
  )

  const [values, setValues] = useState<Record<string, RawValue>>({})
  const [notes, setNotes] = useState("")

  useEffect(() => {
    if (state.error) toast.error(state.error)
  }, [state.error])

  const updateText = (key: string, text: string) => {
    setValues((prev) => ({
      ...prev,
      [key]: { text, bool: prev[key]?.bool ?? false },
    }))
  }

  const updateBool = (key: string, bool: boolean) => {
    setValues((prev) => ({
      ...prev,
      [key]: { text: prev[key]?.text ?? "", bool },
    }))
  }

  const valuesJson = useMemo(() => {
    const rows: SubmittedFieldValue[] = []
    for (const section of sections) {
      for (const field of section.sectionLevelFields) {
        const key = fieldKey(field.id, null)
        const raw = values[key]
        const row = buildRow(field, section.name, raw)
        if (row) rows.push(row)
      }
      for (const eq of section.equipment) {
        for (const field of eq.fields) {
          const key = fieldKey(field.id, eq.id)
          const raw = values[key]
          const row = buildRow(field, eq.name, raw)
          if (row) rows.push(row)
        }
      }
    }
    return JSON.stringify({ notes: notes.trim() || undefined, values: rows })
  }, [sections, values, notes])

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormError message={state.error} />

      {oorAlertsEnabled ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
          Out-of-range readings will trigger an alert to managers.
        </p>
      ) : null}

      {sections.map((section) => {
        const equipmentCount = section.equipment.length
        return (
          <details
            key={section.id}
            open
            className="group rounded-xl border bg-card"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <div className="flex flex-col">
                <span className="text-base font-semibold">{section.name}</span>
                <span className="text-xs text-muted-foreground">
                  {equipmentCount} equipment
                  {equipmentCount === 1 ? "" : ""}
                </span>
              </div>
              <span
                aria-hidden
                className="text-muted-foreground transition-transform group-open:rotate-180"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </summary>

            <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
              {section.sectionLevelFields.length > 0 ? (
                <div className="flex flex-col gap-4">
                  {section.sectionLevelFields.map((field) => (
                    <FieldInput
                      key={fieldKey(field.id, null)}
                      field={field}
                      value={values[fieldKey(field.id, null)]}
                      onText={(t) => updateText(fieldKey(field.id, null), t)}
                      onBool={(b) => updateBool(fieldKey(field.id, null), b)}
                    />
                  ))}
                </div>
              ) : null}

              {section.equipment.map((eq) => (
                <div
                  key={eq.id}
                  className="flex flex-col gap-3 rounded-lg border bg-background p-3"
                >
                  <div className="text-sm font-semibold">{eq.name}</div>
                  {eq.fields.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No fields configured.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-4">
                      {eq.fields.map((field) => (
                        <FieldInput
                          key={fieldKey(field.id, eq.id)}
                          field={field}
                          value={values[fieldKey(field.id, eq.id)]}
                          onText={(t) =>
                            updateText(fieldKey(field.id, eq.id), t)
                          }
                          onBool={(b) =>
                            updateBool(fieldKey(field.id, eq.id), b)
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {section.sectionLevelFields.length === 0 &&
              section.equipment.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No fields configured for this section yet.
                </p>
              ) : null}
            </div>
          </details>
        )
      })}

      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea
          id="notes"
          name="notes_display"
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any general comments about this report?"
          className="min-h-24 text-base"
          enterKeyHint="done"
        />
      </div>

      <input type="hidden" name="values_json" value={valuesJson} />

      <SubmitBar />
    </form>
  )
}

function buildRow(
  field: FieldDef,
  equipmentNameSnapshot: string,
  raw: RawValue | undefined
): SubmittedFieldValue | null {
  const text = raw?.text ?? ""
  const bool = raw?.bool ?? false

  let value_text: string | null = null
  let value_numeric: number | null = null
  let value_boolean: boolean | null = null

  if (field.field_type === "boolean") {
    // Always emit the boolean value the user toggled (default false). Booleans
    // are never "skipped" by emptiness alone — if the user touched it, send it.
    if (raw === undefined) return null
    value_boolean = bool
  } else if (field.field_type === "numeric") {
    if (text.trim() === "") return null
    const n = Number(text)
    if (!Number.isFinite(n)) {
      // Send as text so server can flag, but server uses value_numeric for OOR.
      value_text = text.trim()
    } else {
      value_numeric = n
    }
  } else if (field.field_type === "select") {
    if (text.trim() === "") return null
    value_text = text.trim()
  } else {
    if (text.trim() === "") return null
    value_text = text.trim()
  }

  return {
    field_id: field.id,
    equipment_id: field.equipment_id,
    label_snapshot: field.label,
    equipment_name_snapshot: equipmentNameSnapshot,
    field_type_snapshot: field.field_type,
    unit_snapshot: field.unit,
    value_text,
    value_numeric,
    value_boolean,
  }
}

function FieldInput({
  field,
  value,
  onText,
  onBool,
}: {
  field: FieldDef
  value: RawValue | undefined
  onText: (text: string) => void
  onBool: (bool: boolean) => void
}) {
  const inputId = `f-${field.id}-${field.equipment_id ?? "section"}`
  const labelText = field.unit
    ? `${field.label} (${field.unit})`
    : field.label

  if (field.field_type === "boolean") {
    return (
      <div className="flex items-center gap-3">
        <input
          id={inputId}
          type="checkbox"
          checked={value?.bool ?? false}
          onChange={(e) => onBool(e.target.checked)}
          className="h-5 w-5 rounded border-input"
        />
        <Label htmlFor={inputId} className="text-base">
          {labelText}
        </Label>
      </div>
    )
  }

  if (field.field_type === "select") {
    return (
      <div className="flex flex-col gap-2">
        <Label>{labelText}</Label>
        <Select value={value?.text ?? ""} onValueChange={onText}>
          <SelectTrigger>
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((opt) => (
              <SelectItem key={opt.key} value={opt.key}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  if (field.field_type === "numeric") {
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={inputId}>{labelText}</Label>
        <div className="flex items-center gap-2">
          <Input
            id={inputId}
            type="text"
            inputMode="decimal"
            enterKeyHint="next"
            value={value?.text ?? ""}
            onChange={(e) => onText(e.target.value)}
            className="h-12 flex-1 text-base"
            placeholder="—"
          />
          {field.unit ? (
            <span className="text-sm text-muted-foreground">{field.unit}</span>
          ) : null}
        </div>
      </div>
    )
  }

  // text
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={inputId}>{labelText}</Label>
      <Input
        id={inputId}
        type="text"
        inputMode="text"
        enterKeyHint="next"
        value={value?.text ?? ""}
        onChange={(e) => onText(e.target.value)}
        className="h-12 text-base"
      />
    </div>
  )
}

function SubmitBar() {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending}
      className="h-12 w-full text-base"
    >
      {pending ? "Submitting…" : "Submit refrigeration report"}
    </Button>
  )
}

