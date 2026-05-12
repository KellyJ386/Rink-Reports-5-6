"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useActionState } from "react"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import { BodyDiagram } from "@/components/staff/body-diagram/body-diagram"
import {
  EMPTY_BODY_SELECTIONS,
  isBodyPartKey,
  type BodyPartKey,
  type BodySelections,
  type BodySide,
} from "@/components/staff/body-diagram/types"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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

import { submitAccidentReport, type AccidentFormState } from "../actions"
import type { BodyPartOption, DropdownOption } from "../types"

type Props = {
  defaultInjuredName: string
  defaultInjuredContact: string
  locations: DropdownOption[]
  activities: DropdownOption[]
  severities: DropdownOption[]
  medicalAttentions: DropdownOption[]
  injuryTypes: DropdownOption[]
  bodyParts: BodyPartOption[]
  workersCompInstructions: string | null
}

const initialState: AccidentFormState = {}

function nowForDateTimeLocal(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
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

export function SubmissionForm({
  defaultInjuredName,
  defaultInjuredContact,
  locations,
  activities,
  severities,
  medicalAttentions,
  injuryTypes,
  bodyParts,
  workersCompInstructions,
}: Props) {
  const [state, formAction, isPending] = useActionState(
    submitAccidentReport,
    initialState
  )

  const formRef = useRef<HTMLFormElement>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const defaultOccurredAt = useMemo(() => nowForDateTimeLocal(), [])
  const [occurredAt, setOccurredAt] = useState(defaultOccurredAt)
  const [injuredName, setInjuredName] = useState(defaultInjuredName)
  const [injuredContact, setInjuredContact] = useState(defaultInjuredContact)
  const [locationId, setLocationId] = useState("")
  const [activityId, setActivityId] = useState("")
  const [severityId, setSeverityId] = useState("")
  const [medicalAttentionId, setMedicalAttentionId] = useState("")
  const [primaryInjuryTypeId, setPrimaryInjuryTypeId] = useState("")
  const [description, setDescription] = useState("")
  const [workersComp, setWorkersComp] = useState(false)
  const [workersCompAck, setWorkersCompAck] = useState(false)
  const [selections, setSelections] = useState<BodySelections>(
    () => ({ ...EMPTY_BODY_SELECTIONS })
  )

  useEffect(() => {
    if (state.error) {
      toast.error(state.error)
    }
  }, [state.error])

  const bodyPartIdMap = useMemo(
    () => buildBodyPartIdMap(bodyParts),
    [bodyParts]
  )

  const bodyPartsJson = useMemo(() => {
    const entries: Array<{
      body_part_dropdown_id: string
      side: BodySide
    }> = []
    for (const [key, side] of Object.entries(selections) as Array<
      [BodyPartKey, BodySide]
    >) {
      if (side === "none") continue
      const id = bodyPartIdMap[key]
      if (!id) continue
      entries.push({ body_part_dropdown_id: id, side })
    }
    return JSON.stringify(entries)
  }, [selections, bodyPartIdMap])

  const handleSelectionChange = (key: BodyPartKey, side: BodySide) => {
    setSelections((prev) => ({ ...prev, [key]: side }))
  }

  const selectedMedical = medicalAttentions.find(
    (m) => m.id === medicalAttentionId
  )
  const showMedicalAlertNotice = selectedMedical?.triggersAlert === true

  const submitDisabled = workersComp && !workersCompAck

  const handleSubmitClick = () => {
    if (!formRef.current?.checkValidity()) {
      formRef.current?.reportValidity()
      return
    }
    setConfirmOpen(true)
  }

  const handleConfirm = () => {
    setConfirmOpen(false)
    formRef.current?.requestSubmit()
  }

  return (
    <>
      <form ref={formRef} action={formAction} className="flex flex-col gap-5">
        <input type="hidden" name="body_parts_json" value={bodyPartsJson} />
        <input type="hidden" name="location_dropdown_id" value={locationId} />
        <input type="hidden" name="activity_dropdown_id" value={activityId} />
        <input type="hidden" name="severity_dropdown_id" value={severityId} />
        <input
          type="hidden"
          name="medical_attention_dropdown_id"
          value={medicalAttentionId}
        />
        <input
          type="hidden"
          name="primary_injury_type_dropdown_id"
          value={primaryInjuryTypeId}
        />

        <FormError message={state.error} />

        <div className="flex flex-col gap-2">
          <Label htmlFor="injured_person_name">
            Injured person&apos;s name
          </Label>
          <Input
            id="injured_person_name"
            name="injured_person_name"
            required
            autoComplete="name"
            enterKeyHint="next"
            value={injuredName}
            onChange={(e) => setInjuredName(e.target.value)}
            className="h-12 text-base"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="injured_person_contact">
            Contact (phone or email)
          </Label>
          <Input
            id="injured_person_contact"
            name="injured_person_contact"
            required
            inputMode="text"
            autoComplete="tel"
            enterKeyHint="next"
            value={injuredContact}
            onChange={(e) => setInjuredContact(e.target.value)}
            className="h-12 text-base"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="occurred_at">When did it happen?</Label>
          <Input
            id="occurred_at"
            name="occurred_at"
            required
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            className="h-12 text-base"
          />
        </div>

        <SelectField
          label="Location"
          value={locationId}
          onValueChange={setLocationId}
          options={locations}
          placeholder="Select a location"
        />

        <SelectField
          label="Activity at time of accident"
          value={activityId}
          onValueChange={setActivityId}
          options={activities}
          placeholder="Select an activity"
        />

        <SelectField
          label="Severity"
          value={severityId}
          onValueChange={setSeverityId}
          options={severities}
          placeholder="Select severity"
        />

        <div className="flex flex-col gap-2">
          <SelectField
            label="Medical attention"
            value={medicalAttentionId}
            onValueChange={setMedicalAttentionId}
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

        <SelectField
          label="Primary injury type"
          value={primaryInjuryTypeId}
          onValueChange={setPrimaryInjuryTypeId}
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
          <Label htmlFor="description">What happened?</Label>
          <Textarea
            id="description"
            name="description"
            required
            rows={6}
            minLength={1}
            inputMode="text"
            enterKeyHint="done"
            placeholder="Describe what happened in as much detail as you can."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-32 text-base"
          />
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

        <Button
          type="button"
          size="lg"
          disabled={isPending || submitDisabled}
          onClick={handleSubmitClick}
          className="h-12 w-full text-base"
        >
          {isPending ? "Submitting…" : "Submit accident report"}
        </Button>
      </form>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit this accident report?</AlertDialogTitle>
            <AlertDialogDescription>
              Accident reports can only be edited within 24 hours of submission.
              Make sure all details are accurate before confirming.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmOpen(false)}>
              Go back
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={isPending}>
              {isPending ? "Submitting…" : "Confirm & submit"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function SelectField({
  label,
  value,
  onValueChange,
  options,
  placeholder,
}: {
  label: string
  value: string
  onValueChange: (v: string) => void
  options: DropdownOption[]
  placeholder: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
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
    </div>
  )
}
