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
  READING_KIND_OPTIONS,
  VENTILATION_STATUS_OPTIONS,
  type AirQualityFormData,
  type AirQualityFuelType,
  type AirQualityMeasurement,
  type AirQualityReadingKind,
  type EquipmentForForm,
  type LocationOption,
  type ReadingTypeForm,
  type SubmittedReading,
} from "../types"
import {
  computeTwa,
  evaluateMetric,
  maxAlertLevel,
  type AlertLevel,
  type FrequencyStatus,
  type MetricDef,
  type TierLevel,
} from "../_lib/compliance"
import type { FormComplianceContext } from "../page"

type Props = {
  locations: LocationOption[]
  readingTypes: ReadingTypeForm[]
  equipment: EquipmentForForm[]
  compliance: FormComplianceContext | null
  frequency: FrequencyStatus | null
}

const initialState: SubmissionFormState = {}

function genLocalId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `aq-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function stepFromDecimals(decimals: number): string {
  if (decimals <= 0) return "1"
  return `0.${"0".repeat(decimals - 1)}1`
}

export function SubmissionForm({
  locations,
  readingTypes,
  equipment,
  compliance,
  frequency,
}: Props) {
  const [state, formAction] = useActionState(
    submitAirQualityReport,
    initialState
  )

  const { isOnline } = useSyncQueue()
  const formRef = useRef<HTMLFormElement>(null)
  const [localId] = useState<string>(genLocalId)
  const [queued, setQueued] = useState(false)

  // Location opens unselected; saving is blocked until the operator chooses one.
  const [locationId, setLocationId] = useState<string>("")
  const [values, setValues] = useState<Record<string, string>>({})
  const [equipmentId, setEquipmentId] = useState<string>("")
  const [notes, setNotes] = useState("")
  const [readingKind, setReadingKind] =
    useState<AirQualityReadingKind>("routine")
  const [correctiveNote, setCorrectiveNote] = useState("")

  const locationName = useMemo(
    () => locations.find((l) => l.id === locationId)?.name ?? "",
    [locations, locationId]
  )

  // Equipment scoped to the selected location (or facility-wide / handheld).
  const availableEquipment = useMemo(
    () =>
      equipment.filter(
        (eq) => eq.location_id === null || eq.location_id === locationId
      ),
    [equipment, locationId]
  )

  // Changing location may invalidate the selected equipment; clear it so we
  // never submit a monitor that isn't valid for the new location.
  const handleLocationChange = (nextLocationId: string) => {
    setLocationId(nextLocationId)
    setEquipmentId((prev) =>
      prev &&
      equipment.some(
        (eq) =>
          eq.id === prev &&
          (eq.location_id === null || eq.location_id === nextLocationId)
      )
        ? prev
        : ""
    )
  }
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

  // ---- Jurisdiction-aware evaluation (mirrors the server engine) ----
  const metricBindings = useMemo(() => {
    if (!compliance) return [] as Array<{ metric: MetricDef; readingTypeId: string }>
    const out: Array<{ metric: MetricDef; readingTypeId: string }> = []
    for (const metric of compliance.metrics) {
      const rt = readingTypes.find(
        (r) => r.key === metric.key || r.key.startsWith(`${metric.key}_`),
      )
      if (rt) out.push({ metric, readingTypeId: rt.id })
    }
    return out
  }, [compliance, readingTypes])

  const metricEvals = useMemo(() => {
    if (!compliance) return []
    return metricBindings.flatMap(({ metric, readingTypeId }) => {
      const value = parsedByType.get(readingTypeId)
      if (typeof value !== "number") return []
      const level = evaluateMetric(
        value,
        compliance.effectiveTiers[metric.key] ?? {},
      )
      return [{ metric, readingTypeId, value, level }]
    })
  }, [compliance, metricBindings, parsedByType])

  const overallAlert: AlertLevel = useMemo(
    () => maxAlertLevel(metricEvals.map((m) => m.level)),
    [metricEvals],
  )
  const correctiveRequired = overallAlert !== "within"
  const correctiveSatisfied =
    !correctiveRequired || correctiveNote.trim() !== ""

  const metricByReadingType = useMemo(() => {
    const m = new Map<string, MetricDef>()
    for (const b of metricBindings) m.set(b.readingTypeId, b.metric)
    return m
  }, [metricBindings])

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
      reading_kind: readingKind,
      corrective_action_notes: correctiveNote.trim() || null,
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

      <div className="flex flex-col gap-2 rounded-xl border border-l-4 border-l-module-air bg-card p-4">
        <Label htmlFor="aq-location">
          Location
          <RequiredMark />
        </Label>
        <Select value={locationId} onValueChange={handleLocationChange}>
          <SelectTrigger id="aq-location" className="h-12 text-base">
            <SelectValue placeholder="Select a location" />
          </SelectTrigger>
          <SelectContent>
            {locations.map((loc) => (
              <SelectItem key={loc.id} value={loc.id}>
                {loc.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Where these readings were taken. Required before you can submit.
        </p>
      </div>

      {compliance ? (
        <div className="flex flex-col gap-4 rounded-xl border border-l-4 border-l-module-air bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">
              {compliance.displayName}
            </span>
            <Badge variant={compliance.isBinding ? "error" : "secondary"}>
              {compliance.isBinding ? "Binding" : "Guidance"}
            </Badge>
            <Badge variant="secondary">
              {compliance.method === "twa_1hr" ? "1-hr TWA" : "Single sample"}
            </Badge>
          </div>
          {compliance.guidanceNote ? (
            <p className="text-xs text-muted-foreground">
              {compliance.guidanceNote}
            </p>
          ) : null}
          {frequency ? <FrequencyTracker status={frequency} /> : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="aq-reading-kind">Reading type</Label>
            <Select
              value={readingKind}
              onValueChange={(v) => setReadingKind(v as AirQualityReadingKind)}
            >
              <SelectTrigger id="aq-reading-kind" className="h-12 text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {READING_KIND_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}

      {availableEquipment.length > 0 ? (
        <div className="flex flex-col gap-2">
          <Label>Equipment</Label>
          <Select value={equipmentId} onValueChange={setEquipmentId}>
            <SelectTrigger>
              <SelectValue placeholder="Select equipment" />
            </SelectTrigger>
            <SelectContent>
              {availableEquipment.map((eq) => (
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
              const inputId = `aq-rt-${rt.id}`
              const metric = metricByReadingType.get(rt.id)
              const metricTiers =
                metric && compliance
                  ? (compliance.effectiveTiers[metric.key] ?? {})
                  : null
              const cLevel: AlertLevel =
                metricTiers && parsedNum !== null
                  ? evaluateMetric(parsedNum, metricTiers)
                  : "within"
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
                  {metricTiers ? (
                    <div className="flex flex-col gap-1">
                      <TierHint tiers={metricTiers} unit={rt.unit} />
                      {parsedNum !== null ? (
                        <AlertLevelBadge level={cLevel} />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {compliance && compliance.method === "twa_1hr" ? (
        <TwaHelper
          bindings={metricBindings}
          twaSamples={compliance.twaSamples}
          onApply={(rtId, avg) =>
            setValues((prev) => ({ ...prev, [rtId]: String(avg) }))
          }
        />
      ) : null}

      {compliance && correctiveRequired ? (
        <ComplianceBanner
          level={overallAlert}
          customText={compliance.escalation[overallAlert] ?? null}
        />
      ) : null}

      {compliance && correctiveRequired ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="aq-corrective">
            Corrective action taken
            <RequiredMark />
          </Label>
          <Textarea
            id="aq-corrective"
            rows={3}
            value={correctiveNote}
            onChange={(e) => setCorrectiveNote(e.target.value)}
            placeholder="Describe the corrective steps taken — required before an over-threshold reading can be saved."
            className="text-base"
            aria-required="true"
          />
        </div>
      ) : null}

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

      <MonitoringLogSections
        formData={formData}
        setFormData={setFormData}
        locations={locations}
      />

      <input type="hidden" name="location_id" value={locationId} />
      <input type="hidden" name="readings_json" value={readingsJson} />
      <input type="hidden" name="form_data" value={formDataJson} />
      <input type="hidden" name="reading_type" value={readingKind} />
      <input
        type="hidden"
        name="corrective_action_notes"
        value={correctiveNote.trim()}
      />

      <SubmitBar
        disabled={!locationId || !allRequiredFilled || !correctiveSatisfied}
        locationSelected={Boolean(locationId)}
        correctiveMissing={correctiveRequired && !correctiveSatisfied}
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
  locations,
}: {
  title: string
  description: string
  rows: AirQualityMeasurement[]
  onChange: (rows: AirQualityMeasurement[]) => void
  locations: LocationOption[]
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
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.name}>
                      {loc.name}
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
  locations,
}: {
  formData: AirQualityFormData
  setFormData: Dispatch<SetStateAction<AirQualityFormData>>
  locations: LocationOption[]
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
          locations={locations}
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
          locations={locations}
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
      {isCalibrationStale(monitor.calibration_date) ? (
        <p className="text-xs font-medium text-destructive">
          Calibration is over a year old — recalibrate before relying on this
          monitor.
        </p>
      ) : null}
    </div>
  )
}

/** True when a calibration date is more than 365 days in the past. */
function isCalibrationStale(date: string | null): boolean {
  if (!date) return false
  const t = Date.parse(date)
  if (Number.isNaN(t)) return false
  return Date.now() - t > 365 * 24 * 60 * 60 * 1000
}

const TIER_LABEL: Record<TierLevel, string> = {
  corrective: "Corrective",
  notification: "Notification",
  evacuation: "Evacuation",
}

const TIER_ORDER: TierLevel[] = ["corrective", "notification", "evacuation"]

function TierHint({
  tiers,
  unit,
}: {
  tiers: NonNullable<FormComplianceContext["effectiveTiers"][string]>
  unit: string
}) {
  const parts = TIER_ORDER.flatMap((level) => {
    const max = tiers[level]?.max
    if (max === undefined || max === null) return []
    return [`${TIER_LABEL[level]} > ${max}`]
  })
  if (parts.length === 0) return null
  return (
    <span className="text-xs text-muted-foreground">
      {parts.join(" · ")} {unit}
    </span>
  )
}

function AlertLevelBadge({ level }: { level: AlertLevel }) {
  if (level === "within") return <Badge variant="success">Within range</Badge>
  if (level === "corrective")
    return <Badge variant="warning">Corrective action</Badge>
  if (level === "notification")
    return <Badge variant="error">Notification</Badge>
  return <Badge variant="error">Evacuation</Badge>
}

function ComplianceBanner({
  level,
  customText,
}: {
  level: AlertLevel
  customText?: string | null
}) {
  if (level === "within") return null
  const evac = level === "evacuation"
  const text =
    customText && customText.trim() !== ""
      ? customText
      : level === "evacuation"
        ? "Evacuation level. Evacuate the facility now and contact the fire department immediately."
        : level === "notification"
          ? "Notification level. Notify the fire department within 1 hour and the board of health and the Bureau within 24 hours, then log this reading."
          : "Corrective action required. Increase ventilation, suspend fuel-burning equipment, and re-sample until readings drop below the corrective level. Record the steps you took below."
  return (
    <div
      role="alert"
      className={
        evac
          ? "rounded-xl border border-destructive bg-destructive px-4 py-3 text-sm font-semibold text-destructive-foreground"
          : level === "notification"
            ? "rounded-xl border border-destructive bg-destructive-soft px-4 py-3 text-sm text-destructive-soft-foreground"
            : "rounded-xl border border-warning bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground"
      }
    >
      {text}
    </div>
  )
}

function FrequencyTracker({ status }: { status: FrequencyStatus }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Badge variant={status.onSchedule ? "success" : "warning"}>
        {status.onSchedule ? "On schedule" : `Behind by ${status.behindBy}`}
      </Badge>
      <span className="text-muted-foreground">
        {status.completedTotal} of {status.requiredTotal} this week
        {status.requiredWeekend > 0
          ? ` · weekend ${status.completedWeekend}/${status.requiredWeekend}`
          : ""}
        {status.weekendShortfall ? " (weekend sample needed)" : ""}
      </span>
    </div>
  )
}

function TwaHelper({
  bindings,
  twaSamples,
  onApply,
}: {
  bindings: Array<{ metric: MetricDef; readingTypeId: string }>
  twaSamples: number
  onApply: (readingTypeId: string, avg: number) => void
}) {
  if (bindings.length === 0) return null
  return (
    <CollapsibleSection
      title="1-hour TWA calculator"
      description={`Enter ${twaSamples} readings taken every 5 minutes; the average (sum ÷ ${twaSamples}) fills the reading above.`}
    >
      {bindings.map(({ metric, readingTypeId }) => (
        <TwaMetric
          key={metric.key}
          metric={metric}
          count={twaSamples}
          onApply={(avg) => onApply(readingTypeId, avg)}
        />
      ))}
    </CollapsibleSection>
  )
}

function TwaMetric({
  metric,
  count,
  onApply,
}: {
  metric: MetricDef
  count: number
  onApply: (avg: number) => void
}) {
  const [samples, setSamples] = useState<string[]>(() =>
    Array.from({ length: count }, () => ""),
  )
  const nums = samples.map((s) => {
    const n = Number(s)
    return s.trim() !== "" && Number.isFinite(n) ? n : null
  })
  const avg = computeTwa(nums, count)
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold">
        {metric.label} ({metric.unit})
      </span>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
        {samples.map((s, i) => (
          <Input
            key={i}
            type="text"
            inputMode="decimal"
            value={s}
            onChange={(e) =>
              setSamples((prev) =>
                prev.map((p, j) => (j === i ? e.target.value : p)),
              )
            }
            placeholder={`${i * 5}m`}
            className="h-10 text-sm"
            aria-label={`${metric.label} reading at minute ${i * 5}`}
          />
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">
          Average:{" "}
          {avg !== null ? `${avg.toFixed(metric.decimals)} ${metric.unit}` : "—"}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={avg === null}
          onClick={() => {
            if (avg !== null) onApply(Number(avg.toFixed(metric.decimals)))
          }}
        >
          Use average
        </Button>
      </div>
    </div>
  )
}

function SubmitBar({
  disabled,
  locationSelected,
  correctiveMissing,
  locationName,
  isOnline,
}: {
  disabled: boolean
  locationSelected: boolean
  correctiveMissing: boolean
  locationName: string
  isOnline: boolean
}) {
  const { pending } = useFormStatus()
  const submitLabel = !isOnline
    ? "Save offline"
    : locationSelected
      ? `Submit readings for ${locationName}`
      : "Submit readings"
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
          {!locationSelected
            ? "Choose a location and fill in every required reading to submit."
            : correctiveMissing
              ? "Add a corrective-action note to submit this over-threshold reading."
              : "Fill in every required reading to submit."}
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
