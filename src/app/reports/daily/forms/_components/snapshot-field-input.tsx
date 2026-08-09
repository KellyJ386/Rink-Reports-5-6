"use client"

// One form-builder field, rendered from a frozen SnapshotField. Shared by the
// staff instance editor and the admin builder's live preview so what admins
// preview is exactly what staff get. Controlled; pass `disabled` for the
// read-only (submitted / locked-day) rendering.

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
import { Textarea } from "@/components/ui/textarea"

import type {
  ResponseValue,
  SnapshotField,
} from "@/app/reports/daily/_lib/instance-compute"

type Props = {
  field: SnapshotField
  value: ResponseValue | undefined
  onChange: (value: ResponseValue | undefined) => void
  disabled?: boolean
  idPrefix?: string
}

export function SnapshotFieldInput({
  field,
  value,
  onChange,
  disabled = false,
  idPrefix = "field",
}: Props) {
  const inputId = `${idPrefix}-${field.id}`
  const label = (
    <Label htmlFor={inputId}>
      {field.label}
      {field.required && <RequiredMark />}
    </Label>
  )

  switch (field.field_type) {
    case "text":
      return (
        <div className="flex flex-col gap-1.5">
          {label}
          <Input
            id={inputId}
            className="h-12 text-base"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value || undefined)}
            disabled={disabled}
          />
        </div>
      )
    case "textarea":
      return (
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          {label}
          <Textarea
            id={inputId}
            rows={3}
            className="text-base"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value || undefined)}
            disabled={disabled}
          />
        </div>
      )
    case "number":
      return (
        <div className="flex flex-col gap-1.5">
          {label}
          <Input
            id={inputId}
            type="text"
            inputMode="decimal"
            className="h-12 text-base"
            value={value === undefined ? "" : String(value)}
            onChange={(e) => onChange(e.target.value || undefined)}
            disabled={disabled}
          />
        </div>
      )
    case "select":
      return (
        <div className="flex flex-col gap-1.5">
          {label}
          <Select
            value={typeof value === "string" ? value : ""}
            onValueChange={(v) => onChange(v || undefined)}
            disabled={disabled}
          >
            <SelectTrigger id={inputId} className="h-12 text-base">
              <SelectValue placeholder="Choose…" />
            </SelectTrigger>
            <SelectContent>
              {(field.options ?? []).map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )
    case "multiselect": {
      const selected = Array.isArray(value) ? value : []
      return (
        <fieldset className="flex flex-col gap-1.5 sm:col-span-2">
          <legend className="text-sm font-medium">
            {field.label}
            {field.required && <RequiredMark />}
          </legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
            {(field.options ?? []).map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2 text-sm font-medium"
              >
                <input
                  type="checkbox"
                  className="border-input size-5 rounded border"
                  checked={selected.includes(opt)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, opt]
                      : selected.filter((v) => v !== opt)
                    onChange(next.length > 0 ? next : undefined)
                  }}
                  disabled={disabled}
                />
                {opt}
              </label>
            ))}
          </div>
        </fieldset>
      )
    }
    case "checkbox":
      return (
        <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2">
          <input
            id={inputId}
            type="checkbox"
            className="border-input size-5 rounded border"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
          />
          <span>
            {field.label}
            {field.required && <RequiredMark />}
          </span>
        </label>
      )
    case "time":
      return (
        <div className="flex flex-col gap-1.5">
          {label}
          <Input
            id={inputId}
            type="time"
            className="h-12 text-base"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value || undefined)}
            disabled={disabled}
          />
        </div>
      )
    case "date":
      return (
        <div className="flex flex-col gap-1.5">
          {label}
          <Input
            id={inputId}
            type="date"
            className="h-12 text-base"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value || undefined)}
            disabled={disabled}
          />
        </div>
      )
  }
}
