"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useActionState } from "react"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import { BodyDiagram } from "@/components/staff/body-diagram/lazy"
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

import { submitAccidentReport, type AccidentFormState } from "../actions"
import type { BodyPartOption, DropdownOption } from "../types"

const DISPLAY_FONT =
  "var(--font-anton), Anton, Impact, 'Arial Narrow', sans-serif"
const RED = "#F42A2A"
const RED_DARK = "#C62828"
const NAVY = "#003B6F"
const GREEN = "#4DFF00"
const GREEN_DARK = "#2E9900"
const NAVY_DARK = "#001A3A"

function SectionHead({
  n,
  title,
  sub,
}: {
  n: number
  title: string
  sub?: string
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 9999,
          background: NAVY,
          color: "#fff",
          fontFamily: DISPLAY_FONT,
          fontSize: 18,
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
      >
        {n}
      </div>
      <div>
        <h3
          style={{
            margin: 0,
            fontFamily: DISPLAY_FONT,
            fontSize: 22,
            color: "var(--foreground)",
            textTransform: "uppercase",
            letterSpacing: "-.01em",
          }}
        >
          {title}
        </h3>
        {sub ? (
          <div
            style={{
              fontSize: 12.5,
              color: "var(--muted-foreground)",
              marginTop: 2,
            }}
          >
            {sub}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: 20,
        boxShadow: "0 1px 3px rgba(0,0,0,.05)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </section>
  )
}

function ReportHeaderCard({ draftId }: { draftId: string }) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: "16px 18px",
        display: "flex",
        alignItems: "center",
        gap: 14,
        boxShadow: "0 1px 3px rgba(0,0,0,.05)",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          background: RED,
          color: "#fff",
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
          boxShadow: "0 2px 6px rgba(244,42,42,.35)",
        }}
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
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: ".16em",
            color: RED_DARK,
            textTransform: "uppercase",
          }}
        >
          New report · Draft
        </div>
        <h2
          style={{
            margin: "2px 0 0",
            fontFamily: DISPLAY_FONT,
            fontSize: 22,
            color: "var(--foreground)",
            textTransform: "uppercase",
            letterSpacing: ".01em",
          }}
        >
          {draftId}
        </h2>
      </div>
    </div>
  )
}

function SeverityPills({
  options,
  value,
  onChange,
}: {
  options: DropdownOption[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Severity"
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      {options.map((o) => {
        const on = value === o.id
        const accent = o.color ?? NAVY
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            style={{
              flex: "1 1 120px",
              minWidth: 120,
              padding: "10px 14px",
              borderRadius: 10,
              border: `2px solid ${on ? accent : "var(--border)"}`,
              background: on ? `${accent}1A` : "var(--card)",
              cursor: "pointer",
              textAlign: "left",
              transition: "all .12s",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: ".1em",
                color: accent,
                textTransform: "uppercase",
              }}
            >
              {o.display_name}
            </div>
          </button>
        )
      })}
    </div>
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

  const formRef = useRef<HTMLFormElement>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

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

  const handleSelectionChange = (key: BodyPartKey, side: BodySide) => {
    setSelections((prev) => ({ ...prev, [key]: side }))
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
      <form ref={formRef} action={formAction} className="flex flex-col gap-4">
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
        <SectionCard>
          <SectionHead n={1} title="Person involved" />
          <div className="flex flex-col gap-4">
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
                enterKeyHint="next"
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
                autoComplete="tel"
                enterKeyHint="next"
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
                enterKeyHint="next"
                placeholder="Years"
                value={injuredAge}
                onChange={(e) => setInjuredAge(e.target.value)}
                className="h-12 text-base"
              />
              <FieldError id="injured_person_age-error" message={state.fieldErrors?.injured_person_age} />
            </div>
          </div>
        </SectionCard>

        {/* 2 · What happened */}
        <SectionCard>
          <SectionHead
            n={2}
            title="What happened"
            sub="Severity, injuries, and what the responder saw."
          />
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label>
                Severity<RequiredMark />
              </Label>
              {severities.length > 0 ? (
                <SeverityPills
                  options={severities}
                  value={severityId}
                  onChange={setSeverityId}
                />
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
                inputMode="text"
                enterKeyHint="done"
                placeholder="Describe what happened in as much detail as you can."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-32 text-base"
              />
              <FieldError id="description-error" message={state.fieldErrors?.description} />
            </div>
          </div>
        </SectionCard>

        {/* 3 · Where & when */}
        <SectionCard>
          <SectionHead n={3} title="Where & when" />
          <div className="flex flex-col gap-4">
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
        <SectionCard>
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
                    className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Witness {idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeWitness(idx)}
                        aria-label={`Remove witness ${idx + 1}`}
                        className="inline-flex h-9 items-center rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        Remove
                      </button>
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
                style={{
                  padding: "12px 14px",
                  border: "2px dashed var(--border)",
                  borderRadius: 12,
                  background: "transparent",
                  color: "var(--foreground)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
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
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add witness
              </button>
            ) : null}
          </div>
        </SectionCard>

        {/* 5 · Workers' comp */}
        <SectionCard>
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
                    I have read and understand the workers&apos; comp
                    instructions above.
                  </span>
                </label>
              </div>
            ) : null}
          </div>
        </SectionCard>

        {/* Sticky submit bar */}
        <div
          style={{
            position: "sticky",
            bottom: 0,
            zIndex: 5,
            background: "color-mix(in srgb, var(--card) 92%, transparent)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            border: "1px solid var(--border)",
            borderRadius: 14,
            padding: "12px 14px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 4,
            boxShadow: "0 6px 16px rgba(0,0,0,.08)",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: "var(--muted-foreground)",
              flex: "1 1 160px",
              minWidth: 0,
            }}
          >
            <strong style={{ color: "var(--foreground)", fontWeight: 700 }}>
              Auto-saved
            </strong>
            {" · review before submitting"}
          </div>
          <button
            type="button"
            disabled={isPending || submitDisabled}
            onClick={handleSubmitClick}
            style={{
              padding: "12px 20px",
              borderRadius: 8,
              border: 0,
              cursor:
                isPending || submitDisabled ? "not-allowed" : "pointer",
              background:
                isPending || submitDisabled
                  ? "var(--muted)"
                  : `linear-gradient(180deg, #7AFF40, ${GREEN})`,
              color:
                isPending || submitDisabled
                  ? "var(--muted-foreground)"
                  : NAVY_DARK,
              fontSize: 13.5,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              gap: 6,
              letterSpacing: ".04em",
              textTransform: "uppercase",
              boxShadow:
                isPending || submitDisabled
                  ? "none"
                  : `0 2px 0 0 ${GREEN_DARK}, 0 4px 8px rgba(77,255,0,.30)`,
              opacity: isPending || submitDisabled ? 0.7 : 1,
              transition: "transform .08s",
            }}
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
              >
                <path d="m20 6-11 11-5-5" />
              </svg>
            )}
            {isPending ? "Submitting…" : "Submit report"}
          </button>
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
