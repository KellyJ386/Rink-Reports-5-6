"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { ArrowLeft, CheckCircle2, LayoutDashboard } from "lucide-react"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import { FieldError } from "@/components/ui/field-error"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PageHeader } from "@/components/ui/page-header"
import { RequiredMark } from "@/components/ui/required-mark"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { enqueueSubmission, useSyncQueue } from "@/lib/offline/use-sync-queue"
import { genLocalId } from "@/lib/offline/local-id"
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
  ThresholdSeverity,
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
  severity: ThresholdSeverity | null
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
  /** Facility cap on reading rounds per shift; null = unlimited. */
  readingsPerShift: number | null
  userName: string
  facilityName: string
}

const initialState: SubmissionFormState = {}

type RawValue = {
  text: string
  bool: boolean
}

function fieldKey(fieldId: string, equipmentId: string | null): string {
  return equipmentId ? `${fieldId}::${equipmentId}` : `${fieldId}::null`
}

function noteErrorKey(key: string): string {
  return `note:${key}`
}

/** Local datetime string (yyyy-MM-ddThh:mm) for a datetime-local input default. */
function nowForDateTimeLocal(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`
}

/** Convert a numeric field's displayed value to its canonical (°F) base unit. */
function toCanonical(field: FieldDef, n: number, displayUnit: TempUnit): number {
  return displayUnit === "C" && isTempUnit(field.unit) ? cToF(n) : n
}

/** True when a numeric field's entered value breaches a CRITICAL threshold. */
function isCriticalOutOfRange(
  field: FieldDef,
  raw: RawValue | undefined,
  displayUnit: TempUnit
): boolean {
  if (field.field_type !== "numeric" || field.severity !== "critical") {
    return false
  }
  if (field.normalMin === null && field.normalMax === null) return false
  const text = raw?.text?.trim() ?? ""
  if (text === "") return false
  const n = Number(text)
  if (!Number.isFinite(n)) return false
  const v = toCanonical(field, n, displayUnit)
  const minOut = field.normalMin !== null && v < field.normalMin
  const maxOut = field.normalMax !== null && v > field.normalMax
  return minOut || maxOut
}

function allFieldsOf(section: SectionDef): Array<[FieldDef, string]> {
  const out: Array<[FieldDef, string]> = []
  for (const f of section.sectionLevelFields) out.push([f, section.name])
  for (const eq of section.equipment) {
    for (const f of eq.fields) out.push([f, eq.name])
  }
  return out
}

export function SubmissionForm({
  sections,
  oorAlertsEnabled,
  readingsPerShift,
  userName,
  facilityName,
}: Props) {
  const [state, formAction] = useActionState(
    submitRefrigerationReport,
    initialState
  )

  const [values, setValues] = useState<Record<string, RawValue>>({})
  const [notes, setNotes] = useState("")
  const [followupNotes, setFollowupNotes] = useState<Record<string, string>>({})
  const [readingAt, setReadingAt] = useState<string>(nowForDateTimeLocal)
  const [shift, setShift] = useState("")
  const [roundNo, setRoundNo] = useState("")
  const [displayUnit, setDisplayUnit] = useState<TempUnit>("F")
  // Per-field client-side validation messages, keyed by fieldKey() (and
  // noteErrorKey() for corrective-action notes). Populated on submit; cleared
  // for a field as soon as the user edits it.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const [localId, setLocalId] = useState<string>(genLocalId)
  const [queued, setQueued] = useState(false)
  const { isOnline } = useSyncQueue()

  // Warn before a tab close / hard refresh discards entered readings. Cleared
  // once the submission has been queued offline (online submits navigate via
  // the server action, which doesn't fire beforeunload).
  const hasEnteredData =
    notes.trim() !== "" ||
    Object.values(values).some((v) => v.text.trim() !== "" || v.bool) ||
    Object.values(followupNotes).some((n) => n.trim() !== "")
  useUnsavedGuard(hasEnteredData && !queued)

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

  const updateNote = (key: string, body: string) => {
    clearFieldError(noteErrorKey(key))
    setFollowupNotes((prev) => ({ ...prev, [key]: body }))
  }

  // Lightweight client-side gate (server remains source of truth): required
  // fields non-empty, numeric fields parse, and any CRITICAL out-of-range
  // reading carries a corrective-action note.
  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {}
    for (const section of sections) {
      for (const [field] of allFieldsOf(section)) {
        if (field.field_type === "computed") continue
        const key = fieldKey(field.id, field.equipment_id)
        if (field.field_type === "boolean") continue
        const raw = values[key]
        const text = raw?.text?.trim() ?? ""
        if (field.is_required && text === "") {
          errors[key] = "This field is required."
          continue
        }
        if (field.field_type === "numeric" && text !== "") {
          if (!Number.isFinite(Number(text))) {
            errors[key] = "Enter a valid number."
            continue
          }
        }
        if (isCriticalOutOfRange(field, raw, displayUnit)) {
          if ((followupNotes[key] ?? "").trim() === "") {
            errors[noteErrorKey(key)] =
              "A corrective-action note is required for this critical reading."
          }
        }
      }
    }
    return errors
  }

  const setUnit = (next: TempUnit) => {
    if (next === displayUnit) return
    setValues((prev) => {
      const out: Record<string, RawValue> = { ...prev }
      for (const section of sections) {
        for (const [field] of allFieldsOf(section)) {
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

  // The payload object shared by the online hidden input and the offline queue.
  const buildPayload = (): Record<string, unknown> => {
    const rows: SubmittedFieldValue[] = []
    const followups: Array<{
      field_id: string
      equipment_id: string | null
      body: string
    }> = []
    for (const section of sections) {
      for (const [field, name] of allFieldsOf(section)) {
        const key = fieldKey(field.id, field.equipment_id)
        const row = buildRow(field, name, values[key], displayUnit)
        if (row) rows.push(row)
        if (isCriticalOutOfRange(field, values[key], displayUnit)) {
          const body = (followupNotes[key] ?? "").trim()
          if (body) {
            followups.push({
              field_id: field.id,
              equipment_id: field.equipment_id,
              body,
            })
          }
        }
      }
    }
    let readingAtIso: string | null = null
    if (readingAt) {
      const d = new Date(readingAt)
      if (!Number.isNaN(d.getTime())) readingAtIso = d.toISOString()
    }
    const round = roundNo.trim() === "" ? null : Number(roundNo)
    return {
      notes: notes.trim() || undefined,
      reading_at: readingAtIso,
      shift: shift.trim() || null,
      round_no: Number.isInteger(round) ? round : null,
      values: rows,
      followups,
    }
  }

  const valuesJson = useMemo(
    () => JSON.stringify(buildPayload()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sections, values, notes, followupNotes, readingAt, shift, roundNo, displayUnit]
  )

  if (queued) {
    return (
      <Card className="gap-4 py-8">
        <div className="flex flex-col items-center gap-4 px-6 text-center">
          <div
            aria-hidden
            className="bg-primary/10 text-primary flex h-14 w-14 items-center justify-center rounded-full"
          >
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight">
            Saved on this device
          </h2>
          <p className="text-sm text-muted-foreground">
            You&apos;re offline. This refrigeration report is queued and will
            submit automatically once you&apos;re back online.
          </p>
          <Button asChild variant="outline">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const errors = validate()
        setFieldErrors(errors)
        if (Object.keys(errors).length > 0) {
          e.preventDefault()
          const firstKey = Object.keys(errors)[0]
          const focusTarget = document.querySelector<HTMLElement>(
            `[aria-describedby="fe-${firstKey}"]`
          )
          focusTarget?.focus()
          return
        }
        // Offline: queue in the service worker; it replays to /api/offline-sync
        // (which persists the report with the same checks) once back online.
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          const ok = enqueueSubmission({
            localId,
            moduleKey: "refrigeration",
            action: "submit",
            payload: buildPayload(),
          })
          if (ok) {
            e.preventDefault()
            setLocalId(genLocalId())
            setQueued(true)
            return
          }
          // SW not controlling this page yet — fall through to a normal submit.
        }
      }}
      className="flex flex-col gap-5"
    >
      <PageHeader
        variant="display"
        module="refrig"
        band
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
            <Button asChild variant="outline" size="sm">
              <Link href="/reports">
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Back
              </Link>
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

      <FormError message={state.error} />

      {!isOnline ? (
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          You&apos;re offline. Your report will be saved on this device and
          submitted automatically when you reconnect.
        </p>
      ) : null}

      {oorAlertsEnabled ? (
        <p className="rounded-md border border-warning bg-warning-soft px-3 py-2 text-xs text-warning-soft-foreground">
          Out-of-range readings will trigger an alert to managers.
        </p>
      ) : null}

      {/* Log Information card */}
      <Card className="gap-4 border-l-4 border-l-module-refrig py-5">
        <div className="flex items-center justify-between gap-4 px-6">
          <h2 className="text-lg font-semibold tracking-tight">
            Log Information
          </h2>
          <UnitToggle value={displayUnit} onChange={setUnit} />
        </div>
        <div className="grid gap-4 px-6 sm:grid-cols-2 lg:grid-cols-3">
          <ReadOnlyField label="Facility" value={facilityName} />
          <ReadOnlyField label="Employee" value={userName} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="reading_at">Reading time</Label>
            <Input
              id="reading_at"
              type="datetime-local"
              value={readingAt}
              onChange={(e) => setReadingAt(e.target.value)}
              className="h-12 text-base"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="shift">Shift (optional)</Label>
            <Input
              id="shift"
              type="text"
              value={shift}
              onChange={(e) => setShift(e.target.value)}
              placeholder="e.g. AM / PM / Overnight"
              className="h-12 text-base"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="round_no">
              Round # (optional)
              {readingsPerShift != null ? ` — of ${readingsPerShift}` : ""}
            </Label>
            <Input
              id="round_no"
              type="text"
              inputMode="numeric"
              value={roundNo}
              onChange={(e) => setRoundNo(e.target.value)}
              placeholder="e.g. 1"
              className="h-12 text-base"
            />
            {readingsPerShift != null ? (
              <p className="text-sm text-muted-foreground">
                This facility logs {readingsPerShift} reading
                {readingsPerShift === 1 ? "" : "s"} per shift.
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      {/* Section cards */}
      {sections.map((section) => {
        const hasContent =
          section.sectionLevelFields.length > 0 ||
          section.equipment.some((eq) => eq.fields.length > 0)
        return (
          <Card
            key={section.id}
            className="gap-4 border-l-4 border-l-module-refrig py-5"
          >
            <h2 className="px-6 text-lg font-semibold tracking-tight">
              {section.name}
            </h2>
            <div className="flex flex-col gap-5 px-6">
              {section.sectionLevelFields.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {section.sectionLevelFields.map((field) => {
                    const key = fieldKey(field.id, null)
                    return (
                      <FieldInput
                        key={key}
                        field={field}
                        value={values[key]}
                        error={fieldErrors[key]}
                        requireNote={isCriticalOutOfRange(
                          field,
                          values[key],
                          displayUnit
                        )}
                        note={followupNotes[key] ?? ""}
                        noteError={fieldErrors[noteErrorKey(key)]}
                        displayUnit={displayUnit}
                        onText={(t) => updateText(key, t)}
                        onBool={(b) => updateBool(key, b)}
                        onNote={(n) => updateNote(key, n)}
                      />
                    )
                  })}
                </div>
              ) : null}

              {section.equipment.map((eq) =>
                eq.fields.length === 0 ? null : (
                  <div key={eq.id} className="flex flex-col gap-3">
                    <div className="text-sm font-semibold text-muted-foreground">
                      {eq.name}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {eq.fields.map((field) => {
                        const key = fieldKey(field.id, eq.id)
                        return (
                          <FieldInput
                            key={key}
                            field={field}
                            value={values[key]}
                            error={fieldErrors[key]}
                            requireNote={isCriticalOutOfRange(
                              field,
                              values[key],
                              displayUnit
                            )}
                            note={followupNotes[key] ?? ""}
                            noteError={fieldErrors[noteErrorKey(key)]}
                            displayUnit={displayUnit}
                            onText={(t) => updateText(key, t)}
                            onBool={(b) => updateBool(key, b)}
                            onNote={(n) => updateNote(key, n)}
                          />
                        )
                      })}
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
      <Card className="gap-3 border-l-4 border-l-module-refrig py-5">
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

      <SubmitBar isOnline={isOnline} />
    </form>
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
  // Computed values are derived server-side and are never submitted.
  if (field.field_type === "computed") return null

  const text = raw?.text ?? ""
  const bool = raw?.bool ?? false

  let value_text: string | null = null
  let value_numeric: number | null = null
  let value_boolean: boolean | null = null

  if (field.field_type === "boolean") {
    if (raw === undefined) return null
    value_boolean = bool
  } else if (field.field_type === "numeric") {
    if (text.trim() === "") return null
    const n = Number(text)
    if (!Number.isFinite(n)) {
      value_text = text.trim()
    } else {
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
  requireNote,
  note,
  noteError,
  displayUnit,
  onText,
  onBool,
  onNote,
}: {
  field: FieldDef
  value: RawValue | undefined
  error: string | undefined
  requireNote: boolean
  note: string
  noteError: string | undefined
  displayUnit: TempUnit
  onText: (text: string) => void
  onBool: (bool: boolean) => void
  onNote: (note: string) => void
}) {
  const inputId = `f-${field.id}-${field.equipment_id ?? "section"}`
  const errorId = `fe-${fieldKey(field.id, field.equipment_id)}`
  const noteId = `fe-${noteErrorKey(fieldKey(field.id, field.equipment_id))}`
  const isTemp = isTempUnit(field.unit)
  const activeUnit = isTemp ? `°${displayUnit}` : field.unit
  const labelText = activeUnit ? `${field.label} (${activeUnit})` : field.label
  const reqMark = field.is_required ? <RequiredMark /> : null
  const invalid = Boolean(error)
  const describedBy = invalid ? errorId : undefined

  // Computed fields are read-only; the value is derived server-side at submit.
  if (field.field_type === "computed") {
    return (
      <div className="flex flex-col gap-2">
        <Label>{labelText}</Label>
        <div className="flex h-12 items-center rounded-md border border-dashed border-input bg-input-bg px-3 text-sm text-muted-foreground">
          Calculated automatically on submit
        </div>
      </div>
    )
  }

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
        {requireNote ? (
          <div className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <Label htmlFor={`${inputId}-note`} className="text-xs">
              Corrective action <RequiredMark />
            </Label>
            <Textarea
              id={`${inputId}-note`}
              rows={2}
              value={note}
              onChange={(e) => onNote(e.target.value)}
              aria-invalid={Boolean(noteError) || undefined}
              aria-describedby={noteError ? noteId : undefined}
              placeholder="This reading is critically out of range. Describe the action taken."
              className="text-sm"
            />
            <FieldError id={noteId} message={noteError} />
          </div>
        ) : null}
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

function SubmitBar({ isOnline }: { isOnline: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending}
      className="h-12 w-full text-base"
    >
      {pending
        ? "Submitting…"
        : isOnline
          ? "Submit refrigeration report"
          : "Save on this device"}
    </Button>
  )
}
