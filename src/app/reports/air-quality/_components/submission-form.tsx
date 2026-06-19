"use client"

import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RequiredMark } from "@/components/ui/required-mark"
import { enqueueSubmission, useSyncQueue } from "@/lib/offline/use-sync-queue"
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
import {
  ARENA_STATUS_OPTIONS,
  ELECTRIC_EQUIPMENT_OPTIONS,
  emptyAirQualityFormData,
  emptyMeasurement,
  FUEL_TYPE_OPTIONS,
  MEASUREMENT_LOCATION_OPTIONS,
  VENTILATION_STATUS_OPTIONS,
  type AirQualityFormData,
  type AirQualityFuelType,
  type AirQualityMeasurement,
  type ComplianceRuleForForm,
  type EquipmentForForm,
  type ReadingTypeForm,
  type SubmittedReading,
  type ThresholdForForm,
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

function genLocalId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `aq-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

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

  const { isOnline } = useSyncQueue()
  const formRef = useRef<HTMLFormElement>(null)
  const [localId] = useState<string>(genLocalId)
  const [queued, setQueued] = useState(false)

  const [values, setValues] = useState<Record<string, string>>({})
  const [equipmentId, setEquipmentId] = useState<string>(
    equipment[0]?.id ?? ""
  )
  const [notes, setNotes] = useState("")
  const [formData, setFormData] = useState<AirQualityFormData>(() => {
    const fd = emptyAirQualityFormData()
    fd.date_of_test = new Date().toISOString().slice(0, 10)
    return fd
  })

  const formDataJson = useMemo(() => JSON.stringify(formData), [formData])

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

  const readingsArray = useMemo(() => {
    const rows: SubmittedReading[] = []
    for (const rt of sortedReadingTypes) {
      const v = parsedByType.get(rt.id)
      if (typeof v === "number") {
        rows.push({ reading_type_id: rt.id, value: v })
      }
    }
    return rows
  }, [sortedReadingTypes, parsedByType])

  const readingsJson = useMemo(
    () => JSON.stringify(readingsArray),
    [readingsArray]
  )

  function buildPayload(): Record<string, unknown> {
    return {
      location_id: locationId,
      equipment_id: equipmentId || null,
      notes: notes.trim() || null,
      readings: readingsArray,
      form_data: formData,
    }
  }

  // Offline submit: queue in the service worker; it replays to /api/offline-sync
  // (which runs the same severity engine) once back online. If the SW isn't
  // controlling the page yet, fall through to the normal action so the network
  // error surfaces instead of silently dropping the report.
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const ok = enqueueSubmission({
        localId,
        moduleKey: "air_quality",
        action: "submit",
        payload: buildPayload(),
      })
      if (ok) {
        e.preventDefault()
        setQueued(true)
      }
    }
  }

  if (queued) {
    return (
      <Card className="gap-4 py-8">
        <div className="flex flex-col items-center gap-4 px-6 text-center">
          <div
            aria-hidden
            className="bg-primary/10 text-primary flex h-14 w-14 items-center justify-center rounded-full"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-7 w-7"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold tracking-tight">
            Saved on this device
          </h2>
          <p className="text-muted-foreground text-sm">
            You&apos;re offline, so these readings are queued and will submit
            automatically once you&apos;re back online — the same exceedance
            checks run then. You can keep working.
          </p>
        </div>
      </Card>
    )
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={handleSubmit}
      className="flex flex-col gap-5"
    >
      <FormError message={state.error} />

      {complianceRules.length > 0 ? (
        <details
          open
          className="group rounded-xl border border-l-4 border-l-module-air bg-card"
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

      <div className="flex flex-col gap-4 rounded-xl border border-l-4 border-l-module-air bg-card p-4">
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

      <MonitoringLogSections formData={formData} setFormData={setFormData} />

      <input type="hidden" name="location_id" value={locationId} />
      <input type="hidden" name="readings_json" value={readingsJson} />
      <input type="hidden" name="form_data" value={formDataJson} />

      <SubmitBar
        disabled={!allRequiredFilled}
        locationName={locationName}
        isOnline={isOnline}
      />
    </form>
  )
}

function numOrNull(text: string): number | null {
  if (text.trim() === "") return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

function strOrNull(text: string): string | null {
  return text.trim() === "" ? null : text
}

function CollapsibleSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <details className="group rounded-xl border border-l-4 border-l-module-air bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="flex flex-col">
          <span className="text-base font-semibold">{title}</span>
          {description ? (
            <span className="text-xs text-muted-foreground">{description}</span>
          ) : null}
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
        {children}
      </div>
    </details>
  )
}

function CheckboxRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-3 text-sm">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 rounded border-input accent-primary"
      />
      {label}
    </label>
  )
}

function MeasurementList({
  title,
  description,
  rows,
  onChange,
}: {
  title: string
  description: string
  rows: AirQualityMeasurement[]
  onChange: (rows: AirQualityMeasurement[]) => void
}) {
  const update = (idx: number, patch: Partial<AirQualityMeasurement>) => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {rows.map((row, idx) => (
        <div
          key={idx}
          className="flex flex-col gap-3 rounded-lg border bg-background p-3"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Location</Label>
              <Select
                value={row.location ?? ""}
                onValueChange={(v) => update(idx, { location: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  {MEASUREMENT_LOCATION_OPTIONS.map((loc) => (
                    <SelectItem key={loc} value={loc}>
                      {loc}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Time</Label>
              <Input
                type="time"
                value={row.time ?? ""}
                onChange={(e) => update(idx, { time: strOrNull(e.target.value) })}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">CO (ppm)</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={row.co ?? ""}
                onChange={(e) => update(idx, { co: numOrNull(e.target.value) })}
                placeholder="—"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">NO2 (ppm)</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={row.no2 ?? ""}
                onChange={(e) => update(idx, { no2: numOrNull(e.target.value) })}
                placeholder="—"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Temp (°F)</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={row.temperature ?? ""}
                onChange={(e) =>
                  update(idx, { temperature: numOrNull(e.target.value) })
                }
                placeholder="—"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Note</Label>
            <Input
              type="text"
              value={row.note ?? ""}
              onChange={(e) => update(idx, { note: strOrNull(e.target.value) })}
              placeholder="Optional"
            />
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(rows.filter((_, i) => i !== idx))}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange([...rows, emptyMeasurement()])}
      >
        Add measurement
      </Button>
    </div>
  )
}

function MonitoringLogSections({
  formData,
  setFormData,
}: {
  formData: AirQualityFormData
  setFormData: Dispatch<SetStateAction<AirQualityFormData>>
}) {
  const update = (mutator: (draft: AirQualityFormData) => void) => {
    setFormData((prev) => {
      const next = structuredClone(prev)
      mutator(next)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <CollapsibleSection
        title="Equipment & tester info"
        description="Tester certification and monitoring equipment used."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="aq-date-of-test">Date of test</Label>
            <Input
              id="aq-date-of-test"
              type="date"
              value={formData.date_of_test ?? ""}
              onChange={(e) =>
                update((d) => {
                  d.date_of_test = strOrNull(e.target.value)
                })
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="aq-tester-cert">Tester certification</Label>
            <Input
              id="aq-tester-cert"
              value={formData.tester_certification ?? ""}
              onChange={(e) =>
                update((d) => {
                  d.tester_certification = strOrNull(e.target.value)
                })
              }
              placeholder="Certification details"
            />
          </div>
        </div>

        <MonitorFields
          legend="CO Monitor"
          monitor={formData.equipment.co_monitor}
          onChange={(patch) =>
            update((d) => {
              Object.assign(d.equipment.co_monitor, patch)
            })
          }
        />
        <MonitorFields
          legend="NO2 Monitor"
          monitor={formData.equipment.no2_monitor}
          onChange={(patch) =>
            update((d) => {
              Object.assign(d.equipment.no2_monitor, patch)
            })
          }
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="aq-vent-inspection">
            Ventilation system check — last inspection date
          </Label>
          <Input
            id="aq-vent-inspection"
            type="date"
            value={formData.equipment.ventilation_last_inspection ?? ""}
            onChange={(e) =>
              update((d) => {
                d.equipment.ventilation_last_inspection = strOrNull(
                  e.target.value
                )
              })
            }
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Section 1: General information & equipment status"
        description="Arena status, resurfacers, ventilation, and maintenance."
      >
        <div className="flex flex-col gap-1.5">
          <Label>Arena operating status</Label>
          <Select
            value={formData.section1.arena_status ?? ""}
            onValueChange={(v) =>
              update((d) => {
                d.section1.arena_status = v
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select arena status" />
            </SelectTrigger>
            <SelectContent>
              {ARENA_STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Ice resurfacer(s) used today</h3>
          {formData.section1.resurfacers.map((unit, idx) => (
            <div
              key={idx}
              className="flex flex-col gap-3 rounded-lg border bg-background p-3 sm:flex-row sm:items-end"
            >
              <div className="flex flex-1 flex-col gap-1.5">
                <Label className="text-xs">Make / Model</Label>
                <Input
                  value={unit.make_model ?? ""}
                  onChange={(e) =>
                    update((d) => {
                      d.section1.resurfacers[idx].make_model = strOrNull(
                        e.target.value
                      )
                    })
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:w-44">
                <Label className="text-xs">Fuel type</Label>
                <Select
                  value={unit.fuel_type ?? ""}
                  onValueChange={(v) =>
                    update((d) => {
                      d.section1.resurfacers[idx].fuel_type =
                        v as AirQualityFuelType
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select fuel type" />
                  </SelectTrigger>
                  <SelectContent>
                    {FUEL_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  update((d) => {
                    d.section1.resurfacers.splice(idx, 1)
                  })
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() =>
              update((d) => {
                d.section1.resurfacers.push({
                  make_model: null,
                  fuel_type: null,
                })
              })
            }
          >
            Add resurfacer
          </Button>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">
            Other fuel-burning equipment used today
          </h3>
          {formData.section1.other_equipment.map((unit, idx) => (
            <div
              key={idx}
              className="flex flex-col gap-3 rounded-lg border bg-background p-3 sm:flex-row sm:items-end"
            >
              <div className="flex flex-1 flex-col gap-1.5">
                <Label className="text-xs">Equipment</Label>
                <Input
                  value={unit.name ?? ""}
                  onChange={(e) =>
                    update((d) => {
                      d.section1.other_equipment[idx].name = strOrNull(
                        e.target.value
                      )
                    })
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:w-44">
                <Label className="text-xs">Fuel type</Label>
                <Select
                  value={unit.fuel_type ?? ""}
                  onValueChange={(v) =>
                    update((d) => {
                      d.section1.other_equipment[idx].fuel_type =
                        v as AirQualityFuelType
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select fuel type" />
                  </SelectTrigger>
                  <SelectContent>
                    {FUEL_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  update((d) => {
                    d.section1.other_equipment.splice(idx, 1)
                  })
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() =>
              update((d) => {
                d.section1.other_equipment.push({ name: null, fuel_type: null })
              })
            }
          >
            Add equipment
          </Button>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Ventilation system status</Label>
          <Select
            value={formData.section1.ventilation_status ?? ""}
            onValueChange={(v) =>
              update((d) => {
                d.section1.ventilation_status = v
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select ventilation status" />
            </SelectTrigger>
            <SelectContent>
              {VENTILATION_STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Last maintenance: resurfacer(s)</Label>
            <Input
              value={formData.section1.maintenance.resurfacers ?? ""}
              onChange={(e) =>
                update((d) => {
                  d.section1.maintenance.resurfacers = strOrNull(e.target.value)
                })
              }
              placeholder="Date & performed by"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Last maintenance: ventilation</Label>
            <Input
              value={formData.section1.maintenance.ventilation ?? ""}
              onChange={(e) =>
                update((d) => {
                  d.section1.maintenance.ventilation = strOrNull(e.target.value)
                })
              }
              placeholder="Date & performed by"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Last maintenance: other equipment</Label>
            <Input
              value={formData.section1.maintenance.other ?? ""}
              onChange={(e) =>
                update((d) => {
                  d.section1.maintenance.other = strOrNull(e.target.value)
                })
              }
              placeholder="Date & performed by"
            />
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Section 2: Air quality measurements"
        description="Routine and post-edging monitoring at one or more locations."
      >
        <MeasurementList
          title="A. Routine daily/weekly monitoring"
          description="Minimum: twice on weekdays, once on weekend days."
          rows={formData.section2.routine}
          onChange={(rows) =>
            update((d) => {
              d.section2.routine = rows
            })
          }
        />
        <MeasurementList
          title="B. Post-edging monitoring"
          description="At least once a week, 20 minutes after completion if public present."
          rows={formData.section2.post_edging}
          onChange={(rows) =>
            update((d) => {
              d.section2.post_edging = rows
            })
          }
        />
      </CollapsibleSection>

      <CollapsibleSection
        title="Section 4: Additional recommendations & notes"
        description="Electric equipment, training, signage, and observations."
      >
        <div className="flex flex-col gap-1.5">
          <Label>Consideration for electric equipment</Label>
          <Select
            value={formData.section4.electric_equipment_consideration ?? ""}
            onValueChange={(v) =>
              update((d) => {
                d.section4.electric_equipment_consideration = v
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select option" />
            </SelectTrigger>
            <SelectContent>
              {ELECTRIC_EQUIPMENT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-3">
          <CheckboxRow
            id="aq-staff-trained"
            label="Staff trained"
            checked={formData.section4.staff_trained}
            onChange={(checked) =>
              update((d) => {
                d.section4.staff_trained = checked
              })
            }
          />
          <CheckboxRow
            id="aq-public-signage"
            label="Public signage present"
            checked={formData.section4.public_signage}
            onChange={(checked) =>
              update((d) => {
                d.section4.public_signage = checked
              })
            }
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="aq-observations">
            Any unusual observations or complaints
          </Label>
          <Textarea
            id="aq-observations"
            rows={3}
            value={formData.section4.unusual_observations ?? ""}
            onChange={(e) =>
              update((d) => {
                d.section4.unusual_observations = strOrNull(e.target.value)
              })
            }
            placeholder="e.g., odors, symptoms reported by users"
            className="text-base"
          />
        </div>
      </CollapsibleSection>
    </div>
  )
}

function MonitorFields({
  legend,
  monitor,
  onChange,
}: {
  legend: string
  monitor: AirQualityFormData["equipment"]["co_monitor"]
  onChange: (
    patch: Partial<AirQualityFormData["equipment"]["co_monitor"]>
  ) => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-background p-3">
      <h3 className="text-sm font-semibold">{legend}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Type</Label>
          <Input
            value={monitor.type ?? ""}
            onChange={(e) => onChange({ type: strOrNull(e.target.value) })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Model</Label>
          <Input
            value={monitor.model ?? ""}
            onChange={(e) => onChange({ model: strOrNull(e.target.value) })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Calibration date</Label>
          <Input
            type="date"
            value={monitor.calibration_date ?? ""}
            onChange={(e) =>
              onChange({ calibration_date: strOrNull(e.target.value) })
            }
          />
        </div>
      </div>
    </div>
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
  isOnline,
}: {
  disabled: boolean
  locationName: string
  isOnline: boolean
}) {
  const { pending } = useFormStatus()
  const submitLabel = isOnline
    ? `Submit readings for ${locationName}`
    : "Save offline"
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="submit"
        size="lg"
        disabled={pending || disabled}
        className="h-12 w-full text-base"
      >
        {pending ? "Submitting…" : submitLabel}
      </Button>
      {disabled && !pending ? (
        <p className="text-center text-xs text-muted-foreground">
          Fill in every required reading to submit.
        </p>
      ) : null}
      {!isOnline && !disabled ? (
        <p className="text-muted-foreground text-center text-xs">
          You&apos;re offline. These readings will be saved on your device and
          submitted automatically when you reconnect.
        </p>
      ) : null}
    </div>
  )
}
