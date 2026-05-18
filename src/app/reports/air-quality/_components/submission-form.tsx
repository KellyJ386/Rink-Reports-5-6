"use client"

import { useEffect, useMemo, useState } from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import { Badge } from "@/components/ui/badge"
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
import { Textarea } from "@/components/ui/textarea"

import {
  submitAirQualityReport,
  type SubmissionFormState,
} from "../actions"
import type {
  ComplianceRuleForForm,
  EquipmentForForm,
  ReadingTypeForm,
  SubmittedReading,
  ThresholdForForm,
} from "../types"

type Props = {
  locationId: string
  locationName: string
  readingTypes: ReadingTypeForm[]
  equipment: EquipmentForForm[]
  thresholds: ThresholdForForm[]
  complianceRules: ComplianceRuleForForm[]
}

const initialState: SubmissionFormState = {}

type RangeBadge = "ok" | "warn" | "alert" | "none"

function stepFromDecimals(decimals: number): string {
  if (decimals <= 0) return "1"
  return `0.${"0".repeat(decimals - 1)}1`
}

function pickThreshold(
  thresholds: ThresholdForForm[],
  readingTypeId: string,
  locationId: string
): ThresholdForForm | null {
  const locMatch = thresholds.find(
    (t) => t.reading_type_id === readingTypeId && t.location_id === locationId
  )
  if (locMatch) return locMatch
  const fallback = thresholds.find(
    (t) => t.reading_type_id === readingTypeId && t.location_id === null
  )
  return fallback ?? null
}

function evaluateBadge(
  value: number,
  threshold: ThresholdForForm | null
): RangeBadge {
  if (!threshold) return "none"
  // Alert wins.
  const alertHit =
    (threshold.alert_min !== null && value < threshold.alert_min) ||
    (threshold.alert_max !== null && value >= threshold.alert_max)
  if (alertHit) return "alert"
  // Warn next.
  const warnHit =
    (threshold.warn_min !== null && value < threshold.warn_min) ||
    (threshold.warn_max !== null && value > threshold.warn_max)
  if (warnHit) return "warn"
  // We have a threshold and no warn/alert hit. Treat as within range.
  return "ok"
}

export function SubmissionForm({
  locationId,
  locationName,
  readingTypes,
  equipment,
  thresholds,
  complianceRules,
}: Props) {
  const [state, formAction] = useActionState(
    submitAirQualityReport,
    initialState
  )

  const [values, setValues] = useState<Record<string, string>>({})
  const [equipmentId, setEquipmentId] = useState<string>(
    equipment[0]?.id ?? ""
  )
  const [notes, setNotes] = useState("")

  useEffect(() => {
    if (state.error) toast.error(state.error)
  }, [state.error])

  const updateValue = (rtId: string, text: string) => {
    setValues((prev) => ({ ...prev, [rtId]: text }))
  }

  const sortedReadingTypes = useMemo(
    () =>
      [...readingTypes].sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
        return a.label.localeCompare(b.label)
      }),
    [readingTypes]
  )

  const parsedByType = useMemo(() => {
    const out = new Map<string, number>()
    for (const rt of sortedReadingTypes) {
      const text = values[rt.id]
      if (typeof text !== "string" || text.trim() === "") continue
      const n = Number(text)
      if (!Number.isFinite(n)) continue
      out.set(rt.id, n)
    }
    return out
  }, [sortedReadingTypes, values])

  const allRequiredFilled = useMemo(() => {
    for (const rt of sortedReadingTypes) {
      if (!rt.is_required) continue
      if (!parsedByType.has(rt.id)) return false
    }
    return true
  }, [sortedReadingTypes, parsedByType])

  const readingsJson = useMemo(() => {
    const rows: SubmittedReading[] = []
    for (const rt of sortedReadingTypes) {
      const v = parsedByType.get(rt.id)
      if (typeof v === "number") {
        rows.push({ reading_type_id: rt.id, value: v })
      }
    }
    return JSON.stringify(rows)
  }, [sortedReadingTypes, parsedByType])

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormError message={state.error} />

      {complianceRules.length > 0 ? (
        <details
          open
          className="group rounded-xl border bg-card"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <div className="flex flex-col">
              <span className="text-base font-semibold">
                Compliance reference
              </span>
              <span className="text-xs text-muted-foreground">
                {complianceRules.length} active rule
                {complianceRules.length === 1 ? "" : "s"}
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
          <div className="flex flex-col gap-3 border-t border-border px-4 py-4">
            {complianceRules.map((rule) => (
              <div
                key={rule.id}
                className="flex flex-col gap-1 rounded-lg border bg-background p-3"
              >
                <div className="text-sm font-semibold">{rule.rule_name}</div>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {rule.rule_body}
                </p>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {equipment.length > 0 ? (
        <div className="flex flex-col gap-2">
          <Label>Equipment</Label>
          <Select value={equipmentId} onValueChange={setEquipmentId}>
            <SelectTrigger>
              <SelectValue placeholder="Select equipment" />
            </SelectTrigger>
            <SelectContent>
              {equipment.map((eq) => (
                <SelectItem key={eq.id} value={eq.id}>
                  {eq.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input type="hidden" name="equipment_id" value={equipmentId} />
        </div>
      ) : null}

      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
        <div>
          <h2 className="text-base font-semibold">Readings</h2>
          <p className="text-xs text-muted-foreground">
            All readings marked <span aria-hidden>*</span> are required.
          </p>
        </div>

        {sortedReadingTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No reading types are configured for this facility.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {sortedReadingTypes.map((rt) => {
              const text = values[rt.id] ?? ""
              const parsedNum =
                text.trim() !== "" && Number.isFinite(Number(text))
                  ? Number(text)
                  : null
              const matchedThreshold = pickThreshold(
                thresholds,
                rt.id,
                locationId
              )
              const badge =
                parsedNum !== null
                  ? evaluateBadge(parsedNum, matchedThreshold)
                  : "none"
              const inputId = `aq-rt-${rt.id}`
              return (
                <div key={rt.id} className="flex flex-col gap-2">
                  <Label htmlFor={inputId}>
                    {rt.label}
                    {rt.is_required ? <RequiredMark /> : null}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={inputId}
                      type="text"
                      inputMode="decimal"
                      enterKeyHint="next"
                      step={stepFromDecimals(rt.decimals)}
                      value={text}
                      onChange={(e) => updateValue(rt.id, e.target.value)}
                      className="h-12 flex-1 text-base"
                      placeholder="—"
                      aria-required={rt.is_required ? "true" : undefined}
                      aria-invalid={
                        rt.is_required && parsedNum === null && text.length > 0
                          ? "true"
                          : undefined
                      }
                    />
                    {rt.unit ? (
                      <span className="min-w-10 text-sm text-muted-foreground">
                        {rt.unit}
                      </span>
                    ) : null}
                  </div>
                  {badge !== "none" ? <RangeBadgePill badge={badge} /> : null}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything to flag for the manager?"
          className="min-h-24 text-base"
          enterKeyHint="done"
        />
      </div>

      <input type="hidden" name="location_id" value={locationId} />
      <input type="hidden" name="readings_json" value={readingsJson} />

      <SubmitBar disabled={!allRequiredFilled} locationName={locationName} />
    </form>
  )
}

function RangeBadgePill({ badge }: { badge: Exclude<RangeBadge, "none"> }) {
  if (badge === "ok") return <Badge variant="success">Within range</Badge>
  if (badge === "warn") return <Badge variant="warning">Warn</Badge>
  return <Badge variant="error">Alert</Badge>
}

function SubmitBar({
  disabled,
  locationName,
}: {
  disabled: boolean
  locationName: string
}) {
  const { pending } = useFormStatus()
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="submit"
        size="lg"
        disabled={pending || disabled}
        className="h-12 w-full text-base"
      >
        {pending ? "Submitting…" : `Submit readings for ${locationName}`}
      </Button>
      {disabled && !pending ? (
        <p className="text-center text-xs text-muted-foreground">
          Fill in every required reading to submit.
        </p>
      ) : null}
    </div>
  )
}
