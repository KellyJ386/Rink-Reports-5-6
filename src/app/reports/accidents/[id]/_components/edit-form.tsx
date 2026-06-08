"use client"

import { useEffect, useMemo, useState } from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import { BodyDiagram } from "@/components/staff/body-diagram/lazy"
import {
  BODY_PART_KEYS,
  EMPTY_BODY_SELECTIONS,
  isBodyPartKey,
  isBodySide,
  isLaterality,
  isPairedBodyPartKey,
  type BodyPartKey,
  type BodySelections,
  type Laterality,
  type RegionSelection,
} from "@/components/staff/body-diagram/types"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field-error"
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
  updateAccidentReport,
  type AccidentFormState,
} from "../../actions"
import type { BodyPartOption, DropdownOption } from "../../types"

type InitialReport = {
  id: string
  injured_person_name: string
  injured_person_contact: string
  injured_person_age: number | null
  description: string
  occurred_at: string
  workers_comp: boolean
  workers_comp_acknowledged_at: string | null
  location_dropdown_id: string | null
  activity_dropdown_id: string | null
  severity_dropdown_id: string | null
  medical_attention_dropdown_id: string | null
  primary_injury_type_dropdown_id: string | null
}

type InitialBodyPart = {
  body_part_dropdown_id: string
  side: string
  laterality: string | null
}

type InitialWitness = {
  name: string
  contact: string
  statement: string
}

type WitnessRow = {
  name: string
  contact: string
  statement: string
}

const MAX_WITNESSES = 5
const EMPTY_WITNESS: WitnessRow = { name: "", contact: "", statement: "" }

type Props = {
  reportId: string
  initialReport: InitialReport
  initialBodyParts: InitialBodyPart[]
  initialWitnesses: InitialWitness[]
  locations: DropdownOption[]
  activities: DropdownOption[]
  severities: DropdownOption[]
  medicalAttentions: DropdownOption[]
  injuryTypes: DropdownOption[]
  bodyParts: BodyPartOption[]
  workersCompInstructions: string | null
}

const initialState: AccidentFormState = {}

function isoToDateTimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

function buildInitialSelections(
  initial: InitialBodyPart[],
  bodyParts: BodyPartOption[]
): BodySelections {
  const idToKey = new Map<string, BodyPartKey>()
  for (const bp of bodyParts) {
    if (isBodyPartKey(bp.key)) idToKey.set(bp.id, bp.key)
  }
  const out: BodySelections = {
    ...EMPTY_BODY_SELECTIONS,
    shoulders: { ...EMPTY_BODY_SELECTIONS.shoulders },
    arms: { ...EMPTY_BODY_SELECTIONS.arms },
    upper_arms: { ...EMPTY_BODY_SELECTIONS.upper_arms },
    lower_arms: { ...EMPTY_BODY_SELECTIONS.lower_arms },
    elbows: { ...EMPTY_BODY_SELECTIONS.elbows },
    wrists: { ...EMPTY_BODY_SELECTIONS.wrists },
    hands: { ...EMPTY_BODY_SELECTIONS.hands },
    fingers: { ...EMPTY_BODY_SELECTIONS.fingers },
    upper_legs: { ...EMPTY_BODY_SELECTIONS.upper_legs },
    knees: { ...EMPTY_BODY_SELECTIONS.knees },
    lower_legs: { ...EMPTY_BODY_SELECTIONS.lower_legs },
    ankles: { ...EMPTY_BODY_SELECTIONS.ankles },
    feet: { ...EMPTY_BODY_SELECTIONS.feet },
  }
  for (const row of initial) {
    const key = idToKey.get(row.body_part_dropdown_id)
    if (!key) continue
    if (!isBodySide(row.side) || row.side === "none") continue
    if (isPairedBodyPartKey(key)) {
      const lat: Laterality | null =
        row.laterality && isLaterality(row.laterality) ? row.laterality : null
      const paired = out[key]
      if (lat) {
        paired[lat] = row.side
      } else {
        // Legacy row with no laterality: apply to both sides (matches the
        // pre-split rendering of paired regions).
        paired.left = row.side
        paired.right = row.side
      }
    } else {
      out[key] = row.side
    }
  }
  return out
}

function buildBodyPartIdMap(
  bodyParts: BodyPartOption[]
): Partial<Record<BodyPartKey, string>> {
  const map: Partial<Record<BodyPartKey, string>> = {}
  for (const bp of bodyParts) {
    if (isBodyPartKey(bp.key)) {
      map[bp.key] = bp.id
    }
  }
  return map
}

export function EditForm({
  reportId,
  initialReport,
  initialBodyParts,
  initialWitnesses,
  locations,
  activities,
  severities,
  medicalAttentions,
  injuryTypes,
  bodyParts,
  workersCompInstructions,
}: Props) {
  const action = updateAccidentReport.bind(null, reportId)
  const [state, formAction] = useActionState(action, initialState)

  const [occurredAt, setOccurredAt] = useState(
    isoToDateTimeLocal(initialReport.occurred_at)
  )
  const [injuredName, setInjuredName] = useState(
    initialReport.injured_person_name
  )
  const [injuredContact, setInjuredContact] = useState(
    initialReport.injured_person_contact
  )
  const [injuredAge, setInjuredAge] = useState(
    initialReport.injured_person_age === null ||
      initialReport.injured_person_age === undefined
      ? ""
      : String(initialReport.injured_person_age)
  )
  const [witnesses, setWitnesses] = useState<WitnessRow[]>(() =>
    initialWitnesses.map((w) => ({
      name: w.name,
      contact: w.contact,
      statement: w.statement,
    }))
  )
  const [locationId, setLocationId] = useState(
    initialReport.location_dropdown_id ?? ""
  )
  const [activityId, setActivityId] = useState(
    initialReport.activity_dropdown_id ?? ""
  )
  const [severityId, setSeverityId] = useState(
    initialReport.severity_dropdown_id ?? ""
  )
  const [medicalAttentionId, setMedicalAttentionId] = useState(
    initialReport.medical_attention_dropdown_id ?? ""
  )
  const [primaryInjuryTypeId, setPrimaryInjuryTypeId] = useState(
    initialReport.primary_injury_type_dropdown_id ?? ""
  )
  const [description, setDescription] = useState(initialReport.description)
  const [workersComp, setWorkersComp] = useState(initialReport.workers_comp)
  const wasAlreadyAcked = !!initialReport.workers_comp_acknowledged_at
  const [workersCompAck, setWorkersCompAck] = useState(wasAlreadyAcked)
  const [selections, setSelections] = useState<BodySelections>(
    () => buildInitialSelections(initialBodyParts, bodyParts)
  )

  useEffect(() => {
    if (state.error) toast.error(state.error)
    if (state.ok) toast.success("Report updated.")
  }, [state.error, state.ok])

  useEffect(() => {
    const firstErrorField = state.fieldErrors
      ? Object.keys(state.fieldErrors)[0]
      : undefined
    if (!firstErrorField) return
    const el = document.getElementById(firstErrorField) as HTMLElement | null
    el?.focus()
  }, [state.fieldErrors])

  const bodyPartIdMap = useMemo(
    () => buildBodyPartIdMap(bodyParts),
    [bodyParts]
  )

  const bodyPartsJson = useMemo(() => {
    const entries: Array<{
      body_part_dropdown_id: string
      side: "front" | "back" | "both"
      laterality: "left" | "right" | null
    }> = []
    for (const key of BODY_PART_KEYS) {
      const id = bodyPartIdMap[key]
      if (!id) continue
      if (isPairedBodyPartKey(key)) {
        const paired = selections[key]
        if (paired.left !== "none") {
          entries.push({
            body_part_dropdown_id: id,
            side: paired.left,
            laterality: "left",
          })
        }
        if (paired.right !== "none") {
          entries.push({
            body_part_dropdown_id: id,
            side: paired.right,
            laterality: "right",
          })
        }
      } else {
        const side = selections[key]
        if (side !== "none") {
          entries.push({
            body_part_dropdown_id: id,
            side,
            laterality: null,
          })
        }
      }
    }
    return JSON.stringify(entries)
  }, [selections, bodyPartIdMap])

  const witnessesJson = useMemo(() => {
    const cleaned = witnesses
      .map((w) => ({
        name: w.name.trim(),
        contact: w.contact.trim(),
        statement: w.statement.trim(),
      }))
      .filter((w) => w.name.length > 0)
    return JSON.stringify(cleaned)
  }, [witnesses])

  const handleSelectionChange = (
    key: BodyPartKey,
    value: RegionSelection
  ) => {
    setSelections((prev) => ({ ...prev, [key]: value }))
  }

  const addWitness = () =>
    setWitnesses((prev) =>
      prev.length >= MAX_WITNESSES ? prev : [...prev, { ...EMPTY_WITNESS }]
    )
  const removeWitness = (idx: number) =>
    setWitnesses((prev) => prev.filter((_, i) => i !== idx))
  const updateWitness = (
    idx: number,
    field: keyof WitnessRow,
    value: string
  ) =>
    setWitnesses((prev) =>
      prev.map((w, i) => (i === idx ? { ...w, [field]: value } : w))
    )

  const selectedMedical = medicalAttentions.find(
    (m) => m.id === medicalAttentionId
  )
  const showMedicalAlertNotice = selectedMedical?.triggersAlert === true

  const submitDisabled = workersComp && !workersCompAck

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormError message={state.error} />

      <input type="hidden" name="body_parts_json" value={bodyPartsJson} />
      <input type="hidden" name="witnesses_json" value={witnessesJson} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="injured_person_name">
          Injured person&apos;s name<RequiredMark />
        </Label>
        <Input
          id="injured_person_name"
          name="injured_person_name"
          required
          aria-invalid={state.fieldErrors?.injured_person_name ? "true" : undefined}
          aria-describedby={state.fieldErrors?.injured_person_name ? "injured_person_name-error" : undefined}
          autoComplete="name"
          value={injuredName}
          onChange={(e) => setInjuredName(e.target.value)}
          className="h-12 text-base"
        />
        <FieldError id="injured_person_name-error" message={state.fieldErrors?.injured_person_name} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="injured_person_contact">
          Contact (phone or email)<RequiredMark />
        </Label>
        <Input
          id="injured_person_contact"
          name="injured_person_contact"
          required
          aria-invalid={state.fieldErrors?.injured_person_contact ? "true" : undefined}
          aria-describedby={state.fieldErrors?.injured_person_contact ? "injured_person_contact-error" : undefined}
          inputMode="text"
          value={injuredContact}
          onChange={(e) => setInjuredContact(e.target.value)}
          className="h-12 text-base"
        />
        <FieldError id="injured_person_contact-error" message={state.fieldErrors?.injured_person_contact} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="injured_person_age">Age<RequiredMark /></Label>
        <Input
          id="injured_person_age"
          name="injured_person_age"
          required
          aria-invalid={state.fieldErrors?.injured_person_age ? "true" : undefined}
          aria-describedby={state.fieldErrors?.injured_person_age ? "injured_person_age-error" : undefined}
          type="number"
          min={0}
          max={120}
          step={1}
          inputMode="numeric"
          placeholder="Years"
          value={injuredAge}
          onChange={(e) => setInjuredAge(e.target.value)}
          className="h-12 text-base"
        />
        <FieldError id="injured_person_age-error" message={state.fieldErrors?.injured_person_age} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="occurred_at">When did it happen?<RequiredMark /></Label>
        <Input
          id="occurred_at"
          name="occurred_at"
          required
          aria-invalid={state.fieldErrors?.occurred_at ? "true" : undefined}
          aria-describedby={state.fieldErrors?.occurred_at ? "occurred_at-error" : undefined}
          type="datetime-local"
          value={occurredAt}
          onChange={(e) => setOccurredAt(e.target.value)}
          className="h-12 text-base"
        />
        <FieldError id="occurred_at-error" message={state.fieldErrors?.occurred_at} />
      </div>

      <DropdownField
        label="Location"
        name="location_dropdown_id"
        value={locationId}
        onChange={setLocationId}
        options={locations}
        placeholder="Select a location"
      />

      <DropdownField
        label="Activity at time of accident"
        name="activity_dropdown_id"
        value={activityId}
        onChange={setActivityId}
        options={activities}
        placeholder="Select an activity"
      />

      <DropdownField
        label="Severity"
        name="severity_dropdown_id"
        value={severityId}
        onChange={setSeverityId}
        options={severities}
        placeholder="Select severity"
      />

      <div className="flex flex-col gap-2">
        <DropdownField
          label="Medical attention"
          name="medical_attention_dropdown_id"
          value={medicalAttentionId}
          onChange={setMedicalAttentionId}
          options={medicalAttentions}
          placeholder="Select medical attention"
        />
        {showMedicalAlertNotice ? (
          <p
            role="status"
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200"
          >
            Selecting this option will alert managers.
          </p>
        ) : null}
      </div>

      <DropdownField
        label="Primary injury type"
        name="primary_injury_type_dropdown_id"
        value={primaryInjuryTypeId}
        onChange={setPrimaryInjuryTypeId}
        options={injuryTypes}
        placeholder="Select injury type"
      />

      <div className="flex flex-col gap-2">
        <Label>Body parts affected</Label>
        <p className="text-xs text-muted-foreground">
          Tap regions on the diagram to mark front, back, or both.
        </p>
        <BodyDiagram
          selections={selections}
          onChange={handleSelectionChange}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">What happened?<RequiredMark /></Label>
        <Textarea
          id="description"
          name="description"
          required
          aria-invalid={state.fieldErrors?.description ? "true" : undefined}
          aria-describedby={state.fieldErrors?.description ? "description-error" : undefined}
          rows={6}
          minLength={1}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-32 text-base"
        />
        <FieldError id="description-error" message={state.fieldErrors?.description} />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Label>Witnesses (optional, up to {MAX_WITNESSES})</Label>
          {witnesses.length < MAX_WITNESSES ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addWitness}
            >
              Add witness
            </Button>
          ) : null}
        </div>
        {witnesses.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No witnesses added.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {witnesses.map((w, idx) => (
              <li
                key={idx}
                className="flex flex-col gap-2 rounded-lg border bg-card p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Witness {idx + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeWitness(idx)}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Remove
                  </button>
                </div>
                <Input
                  placeholder="Name"
                  autoComplete="name"
                  value={w.name}
                  onChange={(e) => updateWitness(idx, "name", e.target.value)}
                  className="h-11 text-base"
                />
                <Input
                  placeholder="Phone or email (optional)"
                  autoComplete="off"
                  value={w.contact}
                  onChange={(e) =>
                    updateWitness(idx, "contact", e.target.value)
                  }
                  className="h-11 text-base"
                />
                <Textarea
                  placeholder="What they saw (optional)"
                  rows={3}
                  value={w.statement}
                  onChange={(e) =>
                    updateWitness(idx, "statement", e.target.value)
                  }
                  className="min-h-20 text-base"
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="workers_comp"
            checked={workersComp}
            onChange={(e) => {
              setWorkersComp(e.target.checked)
              if (!e.target.checked) setWorkersCompAck(false)
            }}
            className="mt-1 h-5 w-5"
          />
          <span>
            <span className="font-medium">Workers&apos; comp claim?</span>
            <span className="block text-xs text-muted-foreground">
              Toggle this on if the injured person is an employee filing a
              workers&apos; compensation claim.
            </span>
          </span>
        </label>

        {workersComp ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-md border border-input bg-muted/30 px-3 py-2 text-sm">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Workers&apos; comp instructions
              </p>
              {workersCompInstructions ? (
                <p className="whitespace-pre-wrap text-sm">
                  {workersCompInstructions}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No instructions configured. Contact your administrator.
                </p>
              )}
            </div>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="workers_comp_ack"
                checked={workersCompAck}
                onChange={(e) => setWorkersCompAck(e.target.checked)}
                className="mt-1 h-5 w-5"
                required
              />
              <span>
                I have read and understand the workers&apos; comp instructions
                above.
              </span>
            </label>
          </div>
        ) : null}
      </div>

      <SubmitBar disabled={submitDisabled} />
    </form>
  )
}

function DropdownField({
  label,
  name,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string
  name: string
  value: string
  onChange: (v: string) => void
  options: DropdownOption[]
  placeholder: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.display_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <input type="hidden" name={name} value={value} />
    </div>
  )
}

function SubmitBar({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending || disabled}
      className="h-12 w-full text-base"
    >
      {pending ? "Saving…" : "Save changes"}
    </Button>
  )
}
