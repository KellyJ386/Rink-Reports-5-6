"use client"

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { useActionState } from "react"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard"
import { Card } from "@/components/ui/card"
import { enqueueSubmission, useSyncQueue } from "@/lib/offline/use-sync-queue"
import { genLocalId } from "@/lib/offline/local-id"
import { BodyDiagram } from "@/components/staff/body-diagram/lazy"
import {
  BODY_PART_KEYS,
  EMPTY_BODY_SELECTIONS,
  isBodyPartKey,
  isPairedBodyPartKey,
  type BodyPartKey,
  type BodySelections,
  type RegionSelection,
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
import { FormField } from "@/components/ui/form-field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SectionCard, SectionHead } from "@/components/ui/section-card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  SeverityPillGroup,
  SeverityRadioPill,
} from "@/components/ui/severity"
import { Textarea } from "@/components/ui/textarea"

import { submitAccidentReport, type AccidentFormState } from "../actions"
import type { BodyPartOption, DropdownOption } from "../types"

function ReportHeaderCard({ draftId }: { draftId: string }) {
  return (
    <SectionCard className="flex-row items-center gap-3.5 p-4">
      <div
        aria-hidden="true"
        className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-[var(--module-accidents)] text-white shadow-[var(--shadow-elev-1)]"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.3 3.9 1.8 18A2 2 0 0 0 3.5 21h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-module-accidents">
          New report · Draft
        </div>
        <h2 className="m-0 mt-0.5 font-display text-[22px] leading-none uppercase tracking-[0.01em] text-foreground">
          {draftId}
        </h2>
      </div>
    </SectionCard>
  )
}

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

type WitnessRow = {
  name: string
  contact: string
  statement: string
}

const MAX_WITNESSES = 5
const EMPTY_WITNESS: WitnessRow = { name: "", contact: "", statement: "" }

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

  const { isOnline } = useSyncQueue()
  const formRef = useRef<HTMLFormElement>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [localId] = useState<string>(genLocalId)
  const [queued, setQueued] = useState(false)

  const defaultOccurredAt = useMemo(() => nowForDateTimeLocal(), [])
  const [occurredAt, setOccurredAt] = useState(defaultOccurredAt)
  const [injuredName, setInjuredName] = useState(defaultInjuredName)
  const [injuredContact, setInjuredContact] = useState(defaultInjuredContact)
  const [injuredAge, setInjuredAge] = useState("")
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
  const [witnesses, setWitnesses] = useState<WitnessRow[]>([])

  // Warn before a tab close / hard refresh discards an in-progress report.
  // Identity fields prefill from the session, so dirty-ness is keyed to the
  // incident details the reporter actually typed/selected.
  const hasEnteredData =
    description.trim() !== "" ||
    injuredAge.trim() !== "" ||
    locationId !== "" ||
    activityId !== "" ||
    severityId !== "" ||
    medicalAttentionId !== "" ||
    primaryInjuryTypeId !== "" ||
    witnesses.length > 0 ||
    JSON.stringify(selections) !== JSON.stringify(EMPTY_BODY_SELECTIONS)
  useUnsavedGuard(hasEnteredData && !queued)

  useEffect(() => {
    if (state.error) {
      toast.error(state.error)
    }
  }, [state.error])

  useEffect(() => {
    // Move focus to the first invalid input on per-field validation
    // failure so keyboard / screen-reader users don't have to hunt.
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

  const addWitness = () => {
    setWitnesses((prev) =>
      prev.length >= MAX_WITNESSES ? prev : [...prev, { ...EMPTY_WITNESS }]
    )
  }

  const removeWitness = (idx: number) => {
    setWitnesses((prev) => prev.filter((_, i) => i !== idx))
  }

  const updateWitness = (
    idx: number,
    field: keyof WitnessRow,
    value: string
  ) => {
    setWitnesses((prev) =>
      prev.map((w, i) => (i === idx ? { ...w, [field]: value } : w))
    )
  }

  const selectedMedical = medicalAttentions.find(
    (m) => m.id === medicalAttentionId
  )
  const showMedicalAlertNotice = selectedMedical?.triggersAlert === true

  const submitDisabled = workersComp && !workersCompAck

  // Serialize the form into the SAME shape `buildInputFromPayload` parses, so an
  // offline replay lands identical rows to the online server action.
  function buildPayload(): Record<string, unknown> {
    return {
      injured_person_name: injuredName.trim(),
      injured_person_contact: injuredContact.trim(),
      injured_person_age: injuredAge.trim(),
      description: description.trim(),
      occurred_at: occurredAt,
      location_dropdown_id: locationId || null,
      activity_dropdown_id: activityId || null,
      severity_dropdown_id: severityId || null,
      medical_attention_dropdown_id: medicalAttentionId || null,
      primary_injury_type_dropdown_id: primaryInjuryTypeId || null,
      workers_comp: workersComp,
      workers_comp_ack: workersCompAck,
      body_parts: bodyPartsJson,
      witnesses: witnessesJson,
    }
  }

  // Offline submit: queue in the service worker; it replays to /api/offline-sync
  // (which runs the same persist pipeline) once back online. If the SW isn't
  // controlling the page yet, fall through to the normal action so the network
  // error surfaces instead of silently dropping the report.
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const ok = enqueueSubmission({
        localId,
        moduleKey: "accident_reports",
        action: "submit",
        payload: buildPayload(),
      })
      if (ok) {
        e.preventDefault()
        setQueued(true)
      }
    }
  }

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
            You&apos;re offline, so this accident report is queued and will
            submit automatically once you&apos;re back online — the same checks
            run then. You can keep working.
          </p>
        </div>
      </Card>
    )
  }

  return (
    <>
      <form
        ref={formRef}
        action={formAction}
        onSubmit={handleSubmit}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="body_parts_json" value={bodyPartsJson} />
        <input type="hidden" name="witnesses_json" value={witnessesJson} />
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

        <ReportHeaderCard draftId="DRAFT" />

        {/* 1 · Person involved */}
        <SectionCard module="accidents" accentBorder>
          <SectionHead n={1} title="Person involved" />
          <div className="flex flex-col gap-4">
            <FormField
              label="Injured person's name"
              required
              htmlFor="injured_person_name"
              error={state.fieldErrors?.injured_person_name}
            >
              <Input
                id="injured_person_name"
                name="injured_person_name"
                required
                aria-invalid={state.fieldErrors?.injured_person_name ? "true" : undefined}
                aria-describedby={state.fieldErrors?.injured_person_name ? "injured_person_name-error" : undefined}
                autoComplete="name"
                enterKeyHint="next"
                value={injuredName}
                onChange={(e) => setInjuredName(e.target.value)}
                className="h-12 text-base"
              />
            </FormField>

            <FormField
              label="Contact (phone or email)"
              required
              htmlFor="injured_person_contact"
              error={state.fieldErrors?.injured_person_contact}
            >
              <Input
                id="injured_person_contact"
                name="injured_person_contact"
                required
                aria-invalid={state.fieldErrors?.injured_person_contact ? "true" : undefined}
                aria-describedby={state.fieldErrors?.injured_person_contact ? "injured_person_contact-error" : undefined}
                inputMode="text"
                autoComplete="tel"
                enterKeyHint="next"
                value={injuredContact}
                onChange={(e) => setInjuredContact(e.target.value)}
                className="h-12 text-base"
              />
            </FormField>

            <FormField
              label="Age"
              required
              htmlFor="injured_person_age"
              error={state.fieldErrors?.injured_person_age}
            >
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
                enterKeyHint="next"
                placeholder="Years"
                value={injuredAge}
                onChange={(e) => setInjuredAge(e.target.value)}
                className="h-12 text-base"
              />
            </FormField>
          </div>
        </SectionCard>

        {/* 2 · What happened */}
        <SectionCard module="accidents" accentBorder>
          <SectionHead
            n={2}
            title="What happened"
            sub="Severity, injuries, and what the responder saw."
          />
          <div className="flex flex-col gap-5">
            <FormField label="Severity" required>
              {severities.length > 0 ? (
                <SeverityPillGroup ariaLabel="Severity">
                  {severities.map((o) => (
                    <SeverityRadioPill
                      key={o.id}
                      color={o.color}
                      selected={severityId === o.id}
                      onClick={() => setSeverityId(o.id)}
                      ariaLabel={o.display_name}
                    >
                      {o.display_name}
                    </SeverityRadioPill>
                  ))}
                </SeverityPillGroup>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No severity options configured.
                </p>
              )}
            </FormField>

            <SelectField
              label="Primary injury type"
              value={primaryInjuryTypeId}
              onValueChange={setPrimaryInjuryTypeId}
              options={injuryTypes}
              placeholder="Select injury type"
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
                  className="rounded-md border border-warning bg-warning-soft px-3 py-2 text-xs text-warning-soft-foreground"
                >
                  Selecting this option will alert managers.
                </p>
              ) : null}
            </div>

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

            <FormField
              label="What happened?"
              required
              htmlFor="description"
              error={state.fieldErrors?.description}
            >
              <Textarea
                id="description"
                name="description"
                required
                aria-invalid={state.fieldErrors?.description ? "true" : undefined}
                aria-describedby={state.fieldErrors?.description ? "description-error" : undefined}
                rows={6}
                minLength={1}
                inputMode="text"
                enterKeyHint="done"
                placeholder="Describe what happened in as much detail as you can."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-32 text-base"
              />
            </FormField>
          </div>
        </SectionCard>

        {/* 3 · Where & when */}
        <SectionCard module="accidents" accentBorder>
          <SectionHead n={3} title="Where & when" />
          <div className="flex flex-col gap-4">
            <FormField
              label="When did it happen?"
              required
              htmlFor="occurred_at"
              error={state.fieldErrors?.occurred_at}
            >
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
            </FormField>

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
          </div>
        </SectionCard>

        {/* 4 · Witnesses */}
        <SectionCard module="accidents" accentBorder>
          <SectionHead
            n={4}
            title="Witnesses"
            sub={`Add anyone who saw what happened (up to ${MAX_WITNESSES}).`}
          />
          <div className="flex flex-col gap-3">
            {witnesses.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No witnesses added yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {witnesses.map((w, idx) => (
                  <li
                    key={idx}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Witness {idx + 1}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeWitness(idx)}
                        aria-label={`Remove witness ${idx + 1}`}
                      >
                        Remove
                      </Button>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Input
                        placeholder="Name"
                        autoComplete="name"
                        value={w.name}
                        onChange={(e) =>
                          updateWitness(idx, "name", e.target.value)
                        }
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
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {witnesses.length < MAX_WITNESSES ? (
              <button
                type="button"
                onClick={addWitness}
                className="flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border bg-transparent px-3.5 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-accent/40"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add witness
              </button>
            ) : null}
          </div>
        </SectionCard>

        {/* 5 · Workers' comp */}
        <SectionCard module="accidents" accentBorder>
          <SectionHead
            n={5}
            title="Workers' comp"
            sub="Only required if the injured person is an employee filing a claim."
          />
          <div className="flex flex-col gap-3">
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
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
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
                    I have read and understand the workers&apos; comp
                    instructions above.
                  </span>
                </label>
              </div>
            ) : null}
          </div>
        </SectionCard>

        {/* Sticky submit bar */}
        <div className="sticky bottom-0 z-[5] mt-1 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/90 px-3.5 py-3 shadow-[var(--shadow-elev-2)] backdrop-blur-md">
          <div className="min-w-0 flex-[1_1_160px] text-xs text-muted-foreground">
            <strong className="font-bold text-foreground">Auto-saved</strong>
            {isOnline
              ? " · review before submitting"
              : " · offline — will sync when reconnected"}
          </div>
          <Button
            type="button"
            size="lg"
            disabled={isPending || submitDisabled}
            onClick={handleSubmitClick}
            className="uppercase tracking-[0.04em]"
          >
            {isPending ? null : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m20 6-11 11-5-5" />
              </svg>
            )}
            {isPending
              ? "Submitting…"
              : isOnline
                ? "Submit report"
                : "Save offline"}
          </Button>
        </div>
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
    <FormField label={label}>
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
    </FormField>
  )
}
