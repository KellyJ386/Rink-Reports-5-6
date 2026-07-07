"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useActionState } from "react"
import { Check, ChevronDown } from "lucide-react"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
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
import { Card } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { Callout } from "@/components/ui/callout"
import { enqueueSubmission, useSyncQueue } from "@/lib/offline/use-sync-queue"
import { genLocalId } from "@/lib/offline/local-id"

import { submitIncidentReport } from "../actions"
import type { SubmissionFormState } from "../_lib/submit"

type Option = { id: string; display_name: string }
type SpaceOption = { id: string; name: string }
type IncidentTypeOption = { id: string; name: string }
type Witness = { name: string; phone: string; email: string; statement: string }

export type IncidentFormInitial = {
  occurredAtLocal: string
  severityLevelId: string
  incidentTypeId: string
  activityValue: string
  activityOther: string
  selectedSpaceIds: string[]
  otherSpace: boolean
  locationOther: string
  description: string
  immediateActions: string
  witnesses: Witness[]
  ambulanceFlag: boolean
  personsInvolved: string
  followUpRequired: boolean
}

type FormAction = (
  state: SubmissionFormState,
  formData: FormData,
) => Promise<SubmissionFormState> | SubmissionFormState

type Props = {
  severityLevels: Option[]
  activities: Option[]
  spaces: SpaceOption[]
  incidentTypes: IncidentTypeOption[]
  mode?: "create" | "edit"
  action?: FormAction
  initial?: IncidentFormInitial
}

const initialState: SubmissionFormState = {}
const DESCRIPTION_MAX = 500
const MAX_WITNESSES = 3
export const ACTIVITY_OTHER = "__other__"

function nowForDateTimeLocal(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

function emptyWitness(): Witness {
  return { name: "", phone: "", email: "", statement: "" }
}


export function SubmissionForm({
  severityLevels,
  activities,
  spaces,
  incidentTypes,
  mode = "create",
  action = submitIncidentReport,
  initial,
}: Props) {
  const isEdit = mode === "edit"
  const [state, formAction, isPending] = useActionState(action, initialState)

  const formRef = useRef<HTMLFormElement>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [clientError, setClientError] = useState<string | null>(null)

  const defaultOccurredAt = useMemo(() => nowForDateTimeLocal(), [])
  const [occurredAt, setOccurredAt] = useState(
    initial?.occurredAtLocal ?? defaultOccurredAt,
  )
  const [severityLevelId, setSeverityLevelId] = useState(
    initial?.severityLevelId ?? "",
  )
  const [incidentTypeId, setIncidentTypeId] = useState(
    initial?.incidentTypeId ?? "",
  )
  const [activityValue, setActivityValue] = useState(
    initial?.activityValue ?? "",
  )
  const [activityOther, setActivityOther] = useState(
    initial?.activityOther ?? "",
  )
  const [description, setDescription] = useState(initial?.description ?? "")
  const [immediateActions, setImmediateActions] = useState(
    initial?.immediateActions ?? "",
  )
  const [ambulanceFlag, setAmbulanceFlag] = useState(
    initial?.ambulanceFlag ?? false,
  )
  const [personsInvolved, setPersonsInvolved] = useState(
    initial?.personsInvolved ?? "",
  )
  const [followUpRequired, setFollowUpRequired] = useState(
    initial?.followUpRequired ?? false,
  )

  const [spaceSearch, setSpaceSearch] = useState("")
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<string[]>(
    initial?.selectedSpaceIds ?? [],
  )
  const [otherSpace, setOtherSpace] = useState(initial?.otherSpace ?? false)
  const [locationOther, setLocationOther] = useState(
    initial?.locationOther ?? "",
  )

  const [witnesses, setWitnesses] = useState<Witness[]>(
    initial?.witnesses ?? [],
  )

  // Offline support (create mode only): when there's no connection we queue the
  // submission in the service worker instead of running the server action.
  const { isOnline } = useSyncQueue()
  const [localId, setLocalId] = useState(genLocalId)
  const [queued, setQueued] = useState(false)

  useEffect(() => {
    if (state.error) toast.error(state.error)
  }, [state.error])

  useEffect(() => {
    const firstErrorField = state.fieldErrors
      ? Object.keys(state.fieldErrors)[0]
      : undefined
    if (!firstErrorField) return
    const id =
      firstErrorField === "severity_level_id"
        ? "severity_level_id_trigger"
        : firstErrorField
    const el = document.getElementById(id) as HTMLElement | null
    el?.focus()
  }, [state.fieldErrors])

  const filteredSpaces = useMemo(() => {
    const q = spaceSearch.trim().toLowerCase()
    if (!q) return spaces
    return spaces.filter((s) => s.name.toLowerCase().includes(q))
  }, [spaceSearch, spaces])

  const spacesSummary = useMemo(() => {
    const names = spaces
      .filter((s) => selectedSpaceIds.includes(s.id))
      .map((s) => s.name)
    if (otherSpace) names.push("Other")
    return names
  }, [spaces, selectedSpaceIds, otherSpace])

  function toggleSpace(id: string) {
    setSelectedSpaceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function updateWitness(index: number, patch: Partial<Witness>) {
    setWitnesses((prev) =>
      prev.map((w, i) => (i === index ? { ...w, ...patch } : w)),
    )
  }

  function addWitness() {
    setWitnesses((prev) =>
      prev.length >= MAX_WITNESSES ? prev : [...prev, emptyWitness()],
    )
  }

  function removeWitness(index: number) {
    setWitnesses((prev) => prev.filter((_, i) => i !== index))
  }

  // Serialize complex state into hidden inputs for the server action.
  const activityId = activityValue === ACTIVITY_OTHER ? "" : activityValue
  const activeWitnesses = witnesses.filter(
    (w) => w.name.trim() || w.phone.trim() || w.email.trim() || w.statement.trim(),
  )

  function validateClient(): string | null {
    if (!severityLevelId) return "Please pick a severity level."
    if (selectedSpaceIds.length === 0 && !(otherSpace && locationOther.trim())) {
      return "Please choose at least one facility space (or add an “Other”)."
    }
    if (otherSpace && !locationOther.trim()) {
      return "Please describe the “Other” space, or unselect it."
    }
    if (activityValue === ACTIVITY_OTHER && !activityOther.trim()) {
      return "Please describe the “Other” activity, or pick one from the list."
    }
    for (const w of witnesses) {
      const hasName = w.name.trim().length > 0
      const hasContact = w.phone.trim().length > 0 || w.email.trim().length > 0
      const hasAny =
        hasName || hasContact || w.statement.trim().length > 0
      if (hasAny && !hasName) {
        return "Each witness needs a name."
      }
      if (hasName && !hasContact) {
        return "Each witness needs at least one contact (phone or email)."
      }
    }
    return null
  }

  function handleSubmitClick() {
    setClientError(null)
    if (!formRef.current?.checkValidity()) {
      formRef.current?.reportValidity()
      return
    }
    const err = validateClient()
    if (err) {
      setClientError(err)
      return
    }
    setConfirmOpen(true)
  }

  function buildPayload() {
    return {
      // Reporter identity is filled from the login server-side on replay.
      description: description.trim(),
      occurred_at: occurredAt,
      severity_level_id: severityLevelId,
      incident_type_id: incidentTypeId,
      activity_id: activityId,
      activity_other: activityValue === ACTIVITY_OTHER ? activityOther.trim() : "",
      location_other: otherSpace ? locationOther.trim() : "",
      immediate_actions: immediateActions.trim(),
      ambulance_flag: ambulanceFlag,
      persons_involved: personsInvolved.trim(),
      follow_up_required: followUpRequired,
      space_ids: selectedSpaceIds,
      witnesses: activeWitnesses.map((w) => ({
        name: w.name.trim(),
        phone: w.phone.trim(),
        email: w.email.trim(),
        statement: w.statement.trim(),
      })),
    }
  }

  function resetForNextOfflineEntry() {
    setOccurredAt(nowForDateTimeLocal())
    setSeverityLevelId("")
    setIncidentTypeId("")
    setActivityValue("")
    setActivityOther("")
    setDescription("")
    setImmediateActions("")
    setAmbulanceFlag(false)
    setPersonsInvolved("")
    setFollowUpRequired(false)
    setSpaceSearch("")
    setSelectedSpaceIds([])
    setOtherSpace(false)
    setLocationOther("")
    setWitnesses([])
    setLocalId(genLocalId())
    setQueued(false)
  }

  function handleConfirm() {
    setConfirmOpen(false)
    // Offline create: queue in the service worker; it replays to
    // /api/offline-sync (which persists the report) once back online.
    if (!isEdit && typeof navigator !== "undefined" && !navigator.onLine) {
      const ok = enqueueSubmission({
        localId,
        moduleKey: "incident_reports",
        action: "submit",
        payload: buildPayload(),
      })
      if (ok) {
        setQueued(true)
        return
      }
      // Service worker not controlling this page yet — fall through and let the
      // normal submit attempt surface a connection error.
    }
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
            You&apos;re offline, so this report is queued and will submit
            automatically once you&apos;re back online. You can keep working.
          </p>
          <Button
            type="button"
            onClick={resetForNextOfflineEntry}
            className="h-12 w-full max-w-xs text-base"
          >
            Submit another report
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <>
      <form ref={formRef} action={formAction} className="flex flex-col gap-5">
        {/* Hidden inputs carrying complex state for the server action */}
        <input type="hidden" name="severity_level_id" value={severityLevelId} />
        <input type="hidden" name="incident_type_id" value={incidentTypeId} />
        <input type="hidden" name="activity_id" value={activityId} />
        <input
          type="hidden"
          name="activity_other"
          value={activityValue === ACTIVITY_OTHER ? activityOther : ""}
        />
        <input
          type="hidden"
          name="location_other"
          value={otherSpace ? locationOther : ""}
        />
        <input
          type="hidden"
          name="ambulance_flag"
          value={ambulanceFlag ? "true" : "false"}
        />
        <input
          type="hidden"
          name="follow_up_required"
          value={followUpRequired ? "true" : "false"}
        />
        <input
          type="hidden"
          name="spaces_json"
          value={JSON.stringify(selectedSpaceIds)}
        />
        <input
          type="hidden"
          name="witnesses_json"
          value={JSON.stringify(
            activeWitnesses.map((w) => ({
              name: w.name.trim(),
              phone: w.phone.trim(),
              email: w.email.trim(),
              statement: w.statement.trim(),
            })),
          )}
        />

        <FormError message={state.error ?? clientError ?? undefined} />

        {/* ---------------------------------------------------------------- */}
        {/* When & Where */}
        {/* ---------------------------------------------------------------- */}
        <Card className="gap-4 border-l-4 border-l-module-incidents py-5">
          <h2 className="px-6 text-lg font-semibold tracking-tight">
            When &amp; where
          </h2>
          <div className="flex flex-col gap-4 px-6">
            <div className="flex flex-col gap-2 sm:max-w-xs">
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

            <div className="flex flex-col gap-2">
              <Label htmlFor="space_select">
                Facility space<RequiredMark />
              </Label>
              <p className="text-muted-foreground text-sm">
                Select one or more spaces where the report applies.
              </p>
              <DropdownMenu className="block w-full">
                <DropdownMenuTrigger
                  id="space_select"
                  className="border-input bg-input-bg flex h-12 w-full items-center justify-between gap-2 rounded-md border px-3 text-base outline-none transition-[color,box-shadow,border-color] focus:border-[var(--ring)] focus:ring-[3px] focus:ring-[var(--ring)]/25"
                >
                  <span
                    className={
                      "truncate text-left " +
                      (spacesSummary.length === 0
                        ? "text-foreground-subtle"
                        : "text-foreground")
                    }
                  >
                    {spacesSummary.length === 0
                      ? "Select spaces"
                      : spacesSummary.join(", ")}
                  </span>
                  <ChevronDown className="text-muted-foreground size-4 shrink-0" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="max-h-72 w-full overflow-y-auto"
                >
                  {spaces.length > 6 && (
                    <div className="p-1">
                      <Input
                        aria-label="Search spaces"
                        inputMode="text"
                        placeholder="Search spaces…"
                        value={spaceSearch}
                        onChange={(e) => setSpaceSearch(e.target.value)}
                        className="h-10 text-base"
                      />
                    </div>
                  )}
                  {filteredSpaces.map((s) => {
                    const selected = selectedSpaceIds.includes(s.id)
                    return (
                      <DropdownMenuItem
                        key={s.id}
                        role="menuitemcheckbox"
                        aria-checked={selected}
                        onClick={(e) => {
                          e.preventDefault()
                          toggleSpace(s.id)
                        }}
                        className="justify-between"
                      >
                        <span className="truncate">{s.name}</span>
                        {selected && (
                          <Check className="text-primary size-4 shrink-0" />
                        )}
                      </DropdownMenuItem>
                    )
                  })}
                  {filteredSpaces.length === 0 && (
                    <p className="text-muted-foreground px-2 py-1.5 text-sm">
                      No spaces match “{spaceSearch}”.
                    </p>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    role="menuitemcheckbox"
                    aria-checked={otherSpace}
                    onClick={(e) => {
                      e.preventDefault()
                      setOtherSpace((v) => !v)
                    }}
                    className="justify-between"
                  >
                    <span>Other</span>
                    {otherSpace && (
                      <Check className="text-primary size-4 shrink-0" />
                    )}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {otherSpace && (
                <Input
                  aria-label="Other space"
                  placeholder="Describe the space"
                  value={locationOther}
                  onChange={(e) => setLocationOther(e.target.value)}
                  className="h-11 text-base"
                />
              )}
            </div>
          </div>
        </Card>

        {/* ---------------------------------------------------------------- */}
        {/* What happened */}
        {/* ---------------------------------------------------------------- */}
        <Card className="gap-4 border-l-4 border-l-module-incidents py-5">
          <h2 className="px-6 text-lg font-semibold tracking-tight">
            What happened
          </h2>
          <div className="flex flex-col gap-4 px-6">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="description">Description<RequiredMark /></Label>
                <span
                  className={
                    "text-xs " +
                    (description.length >= DESCRIPTION_MAX
                      ? "text-destructive"
                      : "text-muted-foreground")
                  }
                >
                  {description.length}/{DESCRIPTION_MAX}
                </span>
              </div>
              <Textarea
                id="description"
                name="description"
                required
                maxLength={DESCRIPTION_MAX}
                aria-invalid={state.fieldErrors?.description ? "true" : undefined}
                aria-describedby={state.fieldErrors?.description ? "description-error" : undefined}
                rows={6}
                inputMode="text"
                placeholder="Describe what happened in detail."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-32 text-base"
              />
              <FieldError id="description-error" message={state.fieldErrors?.description} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="activity_trigger">Activity at the time</Label>
                <Select value={activityValue} onValueChange={setActivityValue}>
                  <SelectTrigger id="activity_trigger" className="h-12">
                    <SelectValue placeholder="Select activity" />
                  </SelectTrigger>
                  <SelectContent>
                    {activities.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.display_name}
                      </SelectItem>
                    ))}
                    <SelectItem value={ACTIVITY_OTHER}>Other…</SelectItem>
                  </SelectContent>
                </Select>
                {activityValue === ACTIVITY_OTHER && (
                  <Input
                    aria-label="Other activity"
                    placeholder="Describe the activity"
                    value={activityOther}
                    onChange={(e) => setActivityOther(e.target.value)}
                    className="h-11 text-base"
                  />
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="severity_level_id_trigger">
                  Severity<RequiredMark />
                </Label>
                <Select
                  value={severityLevelId}
                  onValueChange={setSeverityLevelId}
                >
                  <SelectTrigger
                    id="severity_level_id_trigger"
                    className="h-12"
                    aria-invalid={
                      state.fieldErrors?.severity_level_id ? "true" : undefined
                    }
                    aria-describedby={
                      state.fieldErrors?.severity_level_id
                        ? "severity_level_id-error"
                        : undefined
                    }
                  >
                    <SelectValue placeholder="Select severity" />
                  </SelectTrigger>
                  <SelectContent>
                    {severityLevels.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError id="severity_level_id-error" message={state.fieldErrors?.severity_level_id} />
              </div>

              {incidentTypes.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="incident_type_id_trigger">
                    Incident type
                  </Label>
                  <Select
                    value={incidentTypeId}
                    onValueChange={setIncidentTypeId}
                  >
                    <SelectTrigger id="incident_type_id_trigger" className="h-12">
                      <SelectValue placeholder="Select type (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      {incidentTypes.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="immediate_actions">
                Immediate actions taken (optional)
              </Label>
              <Textarea
                id="immediate_actions"
                name="immediate_actions"
                rows={3}
                inputMode="text"
                placeholder="What was done right after?"
                value={immediateActions}
                onChange={(e) => setImmediateActions(e.target.value)}
                className="text-base"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label id="ambulance_flag_label">
                  Was an ambulance called?
                </Label>
                <button
                  type="button"
                  role="switch"
                  aria-checked={ambulanceFlag}
                  aria-labelledby="ambulance_flag_label"
                  onClick={() => setAmbulanceFlag((v) => !v)}
                  className={
                    "h-12 rounded-lg border px-4 text-base font-medium transition-colors " +
                    (ambulanceFlag
                      ? "border-primary bg-primary/15 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted")
                  }
                >
                  {ambulanceFlag ? "Yes — ambulance called" : "No"}
                </button>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="persons_involved">
                  Number of people involved (optional)
                </Label>
                <Input
                  id="persons_involved"
                  name="persons_involved"
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 2"
                  aria-invalid={
                    state.fieldErrors?.persons_involved ? "true" : undefined
                  }
                  aria-describedby={
                    state.fieldErrors?.persons_involved
                      ? "persons_involved-error"
                      : undefined
                  }
                  value={personsInvolved}
                  onChange={(e) =>
                    setPersonsInvolved(e.target.value.replace(/[^\d]/g, ""))
                  }
                  className="h-12 text-base"
                />
                <FieldError
                  id="persons_involved-error"
                  message={state.fieldErrors?.persons_involved}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label id="follow_up_required_label">Follow-up required</Label>
              <button
                type="button"
                role="switch"
                aria-checked={followUpRequired}
                aria-labelledby="follow_up_required_label"
                onClick={() => setFollowUpRequired((v) => !v)}
                className={
                  "h-12 rounded-lg border px-4 text-base font-medium transition-colors sm:max-w-xs " +
                  (followUpRequired
                    ? "border-primary bg-primary/15 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted")
                }
              >
                {followUpRequired ? "Yes — follow-up required" : "No"}
              </button>
            </div>
          </div>
        </Card>

        {/* ---------------------------------------------------------------- */}
        {/* Witnesses */}
        {/* ---------------------------------------------------------------- */}
        <Card className="gap-4 border-l-4 border-l-module-incidents py-5">
          <div className="flex items-center justify-between px-6">
            <h2 className="text-lg font-semibold tracking-tight">
              Witnesses (optional)
            </h2>
            <span className="text-muted-foreground text-xs">
              {witnesses.length}/{MAX_WITNESSES}
            </span>
          </div>
          <div className="flex flex-col gap-4 px-6">
            <p className="text-muted-foreground text-sm">
              For each witness, a name and at least one contact (phone or email)
              are required.
            </p>

            {witnesses.map((w, i) => (
              <div
                key={i}
                className="border-border flex flex-col gap-3 rounded-lg border p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-muted-foreground">
                    Witness {i + 1}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeWitness(i)}
                  >
                    Remove
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`witness_${i}_name`}>Name</Label>
                    <Input
                      id={`witness_${i}_name`}
                      placeholder="Witness full name"
                      value={w.name}
                      onChange={(e) => updateWitness(i, { name: e.target.value })}
                      className="h-11 text-base"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`witness_${i}_phone`}>Phone</Label>
                    <Input
                      id={`witness_${i}_phone`}
                      type="tel"
                      inputMode="tel"
                      placeholder="(555) 123-4567"
                      value={w.phone}
                      onChange={(e) =>
                        updateWitness(i, { phone: e.target.value })
                      }
                      className="h-11 text-base"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`witness_${i}_email`}>Email</Label>
                    <Input
                      id={`witness_${i}_email`}
                      type="email"
                      inputMode="email"
                      placeholder="email@example.com"
                      value={w.email}
                      onChange={(e) =>
                        updateWitness(i, { email: e.target.value })
                      }
                      className="h-11 text-base"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`witness_${i}_statement`}>
                      Brief statement
                    </Label>
                    <Textarea
                      id={`witness_${i}_statement`}
                      rows={2}
                      placeholder="What the witness observed…"
                      value={w.statement}
                      onChange={(e) =>
                        updateWitness(i, { statement: e.target.value })
                      }
                      className="text-base"
                    />
                  </div>
                </div>
              </div>
            ))}

            {witnesses.length < MAX_WITNESSES && (
              <div>
                <Button type="button" variant="outline" onClick={addWitness}>
                  {witnesses.length === 0 ? "Add a witness" : "Add another witness"}
                </Button>
              </div>
            )}
          </div>
        </Card>

        <p className="text-muted-foreground px-1 text-sm">
          {isEdit
            ? "You can edit this report until the 24-hour window closes. Every change is recorded."
            : "You can edit this report for 24 hours after submitting; after that it becomes read-only. A manager will review it."}
        </p>

        {!isEdit && !isOnline && (
          <Callout tone="warning">
            You&apos;re offline. This report will be saved on your device and
            submitted automatically when you reconnect.
          </Callout>
        )}

        <Button
          type="button"
          size="lg"
          disabled={isPending}
          onClick={handleSubmitClick}
          className="h-12 w-full text-base"
        >
          {isPending
            ? isEdit
              ? "Saving…"
              : "Submitting…"
            : isEdit
              ? "Save changes"
              : !isOnline
                ? "Save offline"
                : "Submit incident report"}
        </Button>
      </form>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isEdit
                ? "Save changes to this report?"
                : "Submit this incident report?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isEdit
                ? "Your changes will be recorded in the report's audit trail. Make sure the details are accurate."
                : "You can edit this report for 24 hours after submitting; after that it becomes read-only. Make sure the details are accurate."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmOpen(false)}>
              Go back
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={isPending}>
              {isPending
                ? isEdit
                  ? "Saving…"
                  : "Submitting…"
                : isEdit
                  ? "Save changes"
                  : "Confirm & submit"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
