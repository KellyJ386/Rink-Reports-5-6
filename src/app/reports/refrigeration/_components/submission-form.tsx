"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import {
  ArrowLeft,
  Building2,
  Calendar,
  Clock,
  LayoutDashboard,
  Thermometer,
  User,
} from "lucide-react"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import { FieldError } from "@/components/ui/field-error"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PageHeader } from "@/components/ui/page-header"
import { RequiredMark } from "@/components/ui/required-mark"
import { SectionCard } from "@/components/ui/section-card"
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
  cToF,
  fToC,
  isTempUnit,
  roundTemp,
  type TempUnit,
} from "@/lib/units"

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
  is_required: boolean
  options: RefrigerationFieldOption[]
  normalMin: number | null
  normalMax: number | null
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
  userName: string
  facilityName: string
  tempF: number | null
  tempLocation: string | null
}

const initialState: SubmissionFormState = {}

type RawValue = {
  text: string
  bool: boolean
}

function fieldKey(fieldId: string, equipmentId: string | null): string {
  return equipmentId ? `${fieldId}::${equipmentId}` : `${fieldId}::null`
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })
}

function subscribeClock(cb: () => void) {
  const id = setInterval(cb, 1000)
  return () => clearInterval(id)
}

export function SubmissionForm({
  sections,
  oorAlertsEnabled,
  userName,
  facilityName,
  tempF,
  tempLocation,
}: Props) {
  const router = useRouter()
  const [state, formAction] = useActionState(
    submitRefrigerationReport,
    initialState
  )

  const [values, setValues] = useState<Record<string, RawValue>>({})
  const [notes, setNotes] = useState("")
  const [displayUnit, setDisplayUnit] = useState<TempUnit>("F")
  // Per-field client-side validation messages, keyed by fieldKey(). Populated
  // on submit; cleared for a field as soon as the user edits it.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const nowMs = useSyncExternalStore(
    subscribeClock,
    () => Date.now(),
    () => null
  )
  const now = nowMs == null ? null : new Date(nowMs)

  useEffect(() => {
    if (state.error) toast.error(state.error)
  }, [state.error])

  const clearFieldError = (key: string) => {
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const updateText = (key: string, text: string) => {
    clearFieldError(key)
    setValues((prev) => ({
      ...prev,
      [key]: { text, bool: prev[key]?.bool ?? false },
    }))
  }

  const updateBool = (key: string, bool: boolean) => {
    clearFieldError(key)
    setValues((prev) => ({
      ...prev,
      [key]: { text: prev[key]?.text ?? "", bool },
    }))
  }

  // Lightweight client-side gate: required fields must be non-empty and
  // numeric fields must parse as a finite number. Returns the error map so
  // the caller can both store it and decide whether to block submission.
  // The server action remains the source of truth — this only improves UX.
  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {}
    for (const section of sections) {
      const groups: Array<[FieldDef[], string | null]> = [
        [section.sectionLevelFields, null],
        ...section.equipment.map(
          (eq) => [eq.fields, eq.id] as [FieldDef[], string]
        ),
      ]
      for (const [fields] of groups) {
        for (const field of fields) {
          // Booleans (checkboxes) can't be "empty" in a meaningful way here.
          if (field.field_type === "boolean") continue
          const key = fieldKey(field.id, field.equipment_id)
          const text = values[key]?.text?.trim() ?? ""
          if (field.is_required && text === "") {
            errors[key] = "This field is required."
            continue
          }
          if (field.field_type === "numeric" && text !== "") {
            if (!Number.isFinite(Number(text))) {
              errors[key] = "Enter a valid number."
            }
          }
        }
      }
    }
    return errors
  }

  // Toggle is display-only. Per-field text state always lives in the field's
  // canonical base unit (°F). Flipping the toggle converts the visible text of
  // every temperature field once, so there is no per-keystroke round-tripping.
  const setUnit = (next: TempUnit) => {
    if (next === displayUnit) return
    setValues((prev) => {
      const out: Record<string, RawValue> = { ...prev }
      for (const section of sections) {
        const allFields = [
          ...section.sectionLevelFields,
          ...section.equipment.flatMap((eq) => eq.fields),
        ]
        for (const field of allFields) {
          if (field.field_type !== "numeric" || !isTempUnit(field.unit)) continue
          const key = fieldKey(field.id, field.equipment_id)
          const raw = out[key]
          if (!raw || raw.text.trim() === "") continue
          const n = Number(raw.text)
          if (!Number.isFinite(n)) continue
          const converted = next === "C" ? fToC(n) : cToF(n)
          out[key] = { ...raw, text: String(roundTemp(converted)) }
        }
      }
      return out
    })
    setDisplayUnit(next)
  }

  const valuesJson = useMemo(() => {
    const rows: SubmittedFieldValue[] = []
    for (const section of sections) {
      for (const field of section.sectionLevelFields) {
        const key = fieldKey(field.id, null)
        const row = buildRow(field, section.name, values[key], displayUnit)
        if (row) rows.push(row)
      }
      for (const eq of section.equipment) {
        for (const field of eq.fields) {
          const key = fieldKey(field.id, eq.id)
          const row = buildRow(field, eq.name, values[key], displayUnit)
          if (row) rows.push(row)
        }
      }
    }
    return JSON.stringify({ notes: notes.trim() || undefined, values: rows })
  }, [sections, values, notes, displayUnit])

  const tempLabel =
    typeof tempF === "number"
      ? `${Math.round(tempF)}°F${tempLocation ? ` · ${tempLocation}` : ""}`
      : "Temp unavailable"

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const errors = validate()
        setFieldErrors(errors)
        if (Object.keys(errors).length > 0) {
          e.preventDefault()
          // Focus the first invalid field so keyboard/AT users land on it.
          const firstKey = Object.keys(errors)[0]
          const focusTarget = document.querySelector<HTMLElement>(
            `[aria-describedby="fe-${firstKey}"]`
          )
          focusTarget?.focus()
        }
      }}
      className="flex flex-col gap-5"
    >
      <PageHeader
        variant="display"
        module="refrig"
        breadcrumb={
          <Breadcrumb
            segments={[
              { label: "Reports", href: "/reports" },
              { label: "Refrigeration" },
            ]}
          />
        }
        title="Refrigeration"
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => router.back()}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard">
                <LayoutDashboard className="h-4 w-4" aria-hidden />
                Dashboard
              </Link>
            </Button>
          </>
        }
      />

      <SectionCard
        as="div"
        className="flex-row flex-wrap items-center gap-x-3 gap-y-2 p-4 text-sm"
      >
        <MetaChip icon={<User className="h-4 w-4" aria-hidden />}>
          {userName}
        </MetaChip>
        <MetaChip icon={<Building2 className="h-4 w-4" aria-hidden />}>
          {facilityName}
        </MetaChip>
        <MetaChip icon={<Calendar className="h-4 w-4" aria-hidden />}>
          {now ? formatDate(now) : "—"}
        </MetaChip>
        <MetaChip icon={<Clock className="h-4 w-4" aria-hidden />}>
          {now ? formatTime(now) : "—"}
        </MetaChip>
        <MetaChip icon={<Thermometer className="h-4 w-4" aria-hidden />}>
          {tempLabel}
        </MetaChip>
      </SectionCard>

      <FormError message={state.error} />

      {oorAlertsEnabled ? (
        <p className="rounded-md border border-warning bg-warning-soft px-3 py-2 text-xs text-warning-soft-foreground">
          Out-of-range readings will trigger an alert to managers.
        </p>
      ) : null}

      {/* Log Information card */}
      <Card className="gap-4 py-5">
        <div className="flex items-center justify-between gap-4 px-6">
          <h2 className="text-lg font-semibold tracking-tight">
            Log Information
          </h2>
          <UnitToggle value={displayUnit} onChange={setUnit} />
        </div>
        <div className="grid gap-4 px-6 sm:grid-cols-2 lg:grid-cols-3">
          <ReadOnlyField label="Facility" value={facilityName} />
          <ReadOnlyField label="Employee" value={userName} />
          <ReadOnlyField
            label="Date & Time"
            value={now ? `${formatDate(now)} · ${formatTime(now)}` : "—"}
          />
        </div>
      </Card>

      {/* Section cards */}
      {sections.map((section) => {
        const hasContent =
          section.sectionLevelFields.length > 0 ||
          section.equipment.some((eq) => eq.fields.length > 0)
        return (
          <Card key={section.id} className="gap-4 py-5">
            <h2 className="px-6 text-lg font-semibold tracking-tight">
              {section.name}
            </h2>
            <div className="flex flex-col gap-5 px-6">
              {section.sectionLevelFields.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {section.sectionLevelFields.map((field) => (
                    <FieldInput
                      key={fieldKey(field.id, null)}
                      field={field}
                      value={values[fieldKey(field.id, null)]}
                      error={fieldErrors[fieldKey(field.id, null)]}
                      displayUnit={displayUnit}
                      onText={(t) => updateText(fieldKey(field.id, null), t)}
                      onBool={(b) => updateBool(fieldKey(field.id, null), b)}
                    />
                  ))}
                </div>
              ) : null}

              {section.equipment.map((eq) =>
                eq.fields.length === 0 ? null : (
                  <div key={eq.id} className="flex flex-col gap-3">
                    <div className="text-sm font-semibold text-muted-foreground">
                      {eq.name}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {eq.fields.map((field) => (
                        <FieldInput
                          key={fieldKey(field.id, eq.id)}
                          field={field}
                          value={values[fieldKey(field.id, eq.id)]}
                          error={fieldErrors[fieldKey(field.id, eq.id)]}
                          displayUnit={displayUnit}
                          onText={(t) =>
                            updateText(fieldKey(field.id, eq.id), t)
                          }
                          onBool={(b) =>
                            updateBool(fieldKey(field.id, eq.id), b)
                          }
                        />
                      ))}
                    </div>
                  </div>
                )
              )}

              {!hasContent ? (
                <p className="text-xs text-muted-foreground">
                  No fields configured for this section yet.
                </p>
              ) : null}
            </div>
          </Card>
        )
      })}

      {/* Notes */}
      <Card className="gap-3 py-5">
        <div className="flex flex-col gap-2 px-6">
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
      </Card>

      <input type="hidden" name="values_json" value={valuesJson} />

      <SubmitBar />
    </form>
  )
}

function MetaChip({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <span className="flex items-center gap-2 text-muted-foreground">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <span className="font-medium text-foreground">{children}</span>
    </span>
  )
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <div className="flex h-12 items-center rounded-md border border-input bg-input-bg px-3 text-base text-muted-foreground">
        {value}
      </div>
    </div>
  )
}

function UnitToggle({
  value,
  onChange,
}: {
  value: TempUnit
  onChange: (next: TempUnit) => void
}) {
  return (
    <div className="flex items-center gap-2 text-sm font-medium">
      <span className={value === "F" ? "text-foreground" : "text-muted-foreground"}>
        °F
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value === "C"}
        aria-label="Toggle temperature units between Fahrenheit and Celsius"
        onClick={() => onChange(value === "F" ? "C" : "F")}
        className="relative inline-flex h-6 w-11 items-center rounded-full border border-input bg-input-bg transition-colors focus-visible:ring-[var(--ring)]/40 focus-visible:ring-[3px] focus-visible:outline-none"
      >
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-primary transition-transform",
            value === "C" ? "translate-x-6" : "translate-x-1"
          )}
        />
      </button>
      <span className={value === "C" ? "text-foreground" : "text-muted-foreground"}>
        °C
      </span>
    </div>
  )
}

function buildRow(
  field: FieldDef,
  equipmentNameSnapshot: string,
  raw: RawValue | undefined,
  displayUnit: TempUnit
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
      // Values are entered/displayed in `displayUnit` but stored canonically in
      // the field's base unit (°F) so server thresholds (in °F) still match.
      value_numeric =
        displayUnit === "C" && isTempUnit(field.unit) ? cToF(n) : n
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
  error,
  displayUnit,
  onText,
  onBool,
}: {
  field: FieldDef
  value: RawValue | undefined
  error: string | undefined
  displayUnit: TempUnit
  onText: (text: string) => void
  onBool: (bool: boolean) => void
}) {
  const inputId = `f-${field.id}-${field.equipment_id ?? "section"}`
  // Must match the form-level error map key (fieldKey) so aria-describedby and
  // first-invalid focus resolve correctly.
  const errorId = `fe-${fieldKey(field.id, field.equipment_id)}`
  const isTemp = isTempUnit(field.unit)
  const activeUnit = isTemp ? `°${displayUnit}` : field.unit
  const labelText = activeUnit ? `${field.label} (${activeUnit})` : field.label
  const reqMark = field.is_required ? <RequiredMark /> : null
  const invalid = Boolean(error)
  const describedBy = invalid ? errorId : undefined

  if (field.field_type === "boolean") {
    return (
      <div className="flex items-center gap-3">
        <input
          id={inputId}
          type="checkbox"
          required={field.is_required}
          aria-required={field.is_required ? "true" : undefined}
          checked={value?.bool ?? false}
          onChange={(e) => onBool(e.target.checked)}
          className="h-5 w-5 rounded border-input"
        />
        <Label htmlFor={inputId} className="text-base">
          {labelText}
          {reqMark}
        </Label>
      </div>
    )
  }

  if (field.field_type === "select") {
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${inputId}-trigger`}>
          {labelText}
          {reqMark}
        </Label>
        <Select
          value={value?.text ?? ""}
          onValueChange={onText}
          required={field.is_required}
        >
          <SelectTrigger
            id={`${inputId}-trigger`}
            aria-required={field.is_required ? "true" : undefined}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
          >
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
        <FieldError id={errorId} message={error} />
      </div>
    )
  }

  if (field.field_type === "numeric") {
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={inputId}>
          {labelText}
          {reqMark}
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id={inputId}
            type="text"
            inputMode="decimal"
            enterKeyHint="next"
            required={field.is_required}
            aria-required={field.is_required ? "true" : undefined}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            value={value?.text ?? ""}
            onChange={(e) => onText(e.target.value)}
            className="h-12 flex-1 text-base"
            placeholder="0"
          />
          {activeUnit ? (
            <span className="text-sm text-muted-foreground">{activeUnit}</span>
          ) : null}
        </div>
        <FieldError id={errorId} message={error} />
        <NormalRangeHint field={field} displayUnit={displayUnit} />
      </div>
    )
  }

  // text
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={inputId}>
        {labelText}
        {reqMark}
      </Label>
      <Input
        id={inputId}
        type="text"
        inputMode="text"
        enterKeyHint="next"
        required={field.is_required}
        aria-required={field.is_required ? "true" : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={value?.text ?? ""}
        onChange={(e) => onText(e.target.value)}
        className="h-12 text-base"
      />
      <FieldError id={errorId} message={error} />
    </div>
  )
}

function NormalRangeHint({
  field,
  displayUnit,
}: {
  field: FieldDef
  displayUnit: TempUnit
}) {
  if (field.normalMin === null && field.normalMax === null) return null

  const isTemp = isTempUnit(field.unit)
  const convert = (v: number) =>
    isTemp && displayUnit === "C" ? roundTemp(fToC(v)) : v
  const unit = isTemp ? `°${displayUnit}` : (field.unit ?? "")

  const min = field.normalMin === null ? null : convert(field.normalMin)
  const max = field.normalMax === null ? null : convert(field.normalMax)

  let range: string
  if (min !== null && max !== null) range = `${min} – ${max}`
  else if (min !== null) range = `≥ ${min}`
  else range = `≤ ${max}`

  return (
    <p className="text-sm text-muted-foreground">
      Normal: {range}
      {unit ? ` ${unit}` : ""}
    </p>
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
