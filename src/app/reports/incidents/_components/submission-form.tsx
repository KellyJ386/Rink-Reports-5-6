"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useActionState } from "react"
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

import { submitIncidentReport, type SubmissionFormState } from "../actions"
import type { IncidentSeverityLevel, IncidentType } from "../types"

type Props = {
  defaultReporterName: string
  defaultReporterPhone: string
  incidentTypes: Pick<IncidentType, "id" | "name">[]
  severityLevels: Pick<IncidentSeverityLevel, "id" | "display_name">[]
}

const initialState: SubmissionFormState = {}

function nowForDateTimeLocal(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

export function SubmissionForm({
  defaultReporterName,
  defaultReporterPhone,
  incidentTypes,
  severityLevels,
}: Props) {
  const [state, formAction, isPending] = useActionState(
    submitIncidentReport,
    initialState
  )

  const formRef = useRef<HTMLFormElement>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const defaultOccurredAt = useMemo(() => nowForDateTimeLocal(), [])
  const [occurredAt, setOccurredAt] = useState(defaultOccurredAt)
  const [reporterName, setReporterName] = useState(defaultReporterName)
  const [reporterPhone, setReporterPhone] = useState(defaultReporterPhone)
  const [incidentTypeId, setIncidentTypeId] = useState("")
  const [severityLevelId, setSeverityLevelId] = useState("")
  const [location, setLocation] = useState("")
  const [description, setDescription] = useState("")

  useEffect(() => {
    if (state.error) {
      toast.error(state.error)
    }
  }, [state.error])

  useEffect(() => {
    // On per-field validation failure, move focus to the first invalid
    // input so keyboard / screen-reader users don't have to hunt for it.
    const firstErrorField = state.fieldErrors
      ? Object.keys(state.fieldErrors)[0]
      : undefined
    if (!firstErrorField) return
    // Select trigger ids use the "_trigger" suffix because the Select
    // root has no focusable element of its own; everything else is keyed
    // by name == input id.
    const idCandidates =
      firstErrorField === "incident_type_id" || firstErrorField === "severity_level_id"
        ? [`${firstErrorField}_trigger`]
        : [firstErrorField]
    for (const id of idCandidates) {
      const el = document.getElementById(id) as HTMLElement | null
      if (el) {
        el.focus()
        break
      }
    }
  }, [state.fieldErrors])

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
        {/* Hidden selects carry values for server action */}
        <input type="hidden" name="incident_type_id" value={incidentTypeId} />
        <input type="hidden" name="severity_level_id" value={severityLevelId} />

        <FormError message={state.error} />

        <Card className="gap-4 py-5">
          <h2 className="px-6 text-lg font-semibold tracking-tight">Reporter</h2>
          <div className="grid gap-4 px-6 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="reporter_name">Your name<RequiredMark /></Label>
              <Input
                id="reporter_name"
                name="reporter_name"
                required
                aria-invalid={state.fieldErrors?.reporter_name ? "true" : undefined}
                aria-describedby={state.fieldErrors?.reporter_name ? "reporter_name-error" : undefined}
                autoComplete="name"
                enterKeyHint="next"
                value={reporterName}
                onChange={(e) => setReporterName(e.target.value)}
                className="h-12 text-base"
              />
              <FieldError id="reporter_name-error" message={state.fieldErrors?.reporter_name} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="reporter_phone">Phone number<RequiredMark /></Label>
              <Input
                id="reporter_phone"
                name="reporter_phone"
                required
                aria-invalid={state.fieldErrors?.reporter_phone ? "true" : undefined}
                aria-describedby={state.fieldErrors?.reporter_phone ? "reporter_phone-error" : undefined}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                enterKeyHint="next"
                value={reporterPhone}
                onChange={(e) => setReporterPhone(e.target.value)}
                className="h-12 text-base"
              />
              <FieldError id="reporter_phone-error" message={state.fieldErrors?.reporter_phone} />
            </div>
          </div>
        </Card>

        <Card className="gap-4 py-5">
          <h2 className="px-6 text-lg font-semibold tracking-tight">
            Incident details
          </h2>
          <div className="flex flex-col gap-4 px-6">
            <div className="grid gap-4 sm:grid-cols-2">
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

              <div className="flex flex-col gap-2">
                <Label htmlFor="location">Location (optional)</Label>
                <Input
                  id="location"
                  name="location"
                  inputMode="text"
                  enterKeyHint="next"
                  placeholder="e.g. Ice rink lobby, locker room 3"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="h-12 text-base"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="incident_type_id_trigger">Incident type<RequiredMark /></Label>
                <Select value={incidentTypeId} onValueChange={setIncidentTypeId} required>
                  <SelectTrigger
                    id="incident_type_id_trigger"
                    aria-invalid={state.fieldErrors?.incident_type_id ? "true" : undefined}
                    aria-describedby={state.fieldErrors?.incident_type_id ? "incident_type_id-error" : undefined}
                  >
                    <SelectValue placeholder="Select an incident type" />
                  </SelectTrigger>
                  <SelectContent>
                    {incidentTypes.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError id="incident_type_id-error" message={state.fieldErrors?.incident_type_id} />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="severity_level_id_trigger">Severity<RequiredMark /></Label>
                <Select value={severityLevelId} onValueChange={setSeverityLevelId} required>
                  <SelectTrigger
                    id="severity_level_id_trigger"
                    aria-invalid={state.fieldErrors?.severity_level_id ? "true" : undefined}
                    aria-describedby={state.fieldErrors?.severity_level_id ? "severity_level_id-error" : undefined}
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
                placeholder="Describe what happened in as much detail as you can. Who was involved? What was done?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-32 text-base"
              />
              <FieldError id="description-error" message={state.fieldErrors?.description} />
            </div>
          </div>
        </Card>

        <Button
          type="button"
          size="lg"
          disabled={isPending}
          onClick={handleSubmitClick}
          className="h-12 w-full text-base"
        >
          {isPending ? "Submitting…" : "Submit incident report"}
        </Button>
      </form>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit this incident report?</AlertDialogTitle>
            <AlertDialogDescription>
              Incident reports cannot be edited after submission. Make sure all
              details are accurate before confirming.
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
