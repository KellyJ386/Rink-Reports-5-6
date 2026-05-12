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

        <div className="flex flex-col gap-2">
          <Label htmlFor="reporter_name">Your name</Label>
          <Input
            id="reporter_name"
            name="reporter_name"
            required
            autoComplete="name"
            enterKeyHint="next"
            value={reporterName}
            onChange={(e) => setReporterName(e.target.value)}
            className="h-12 text-base"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="reporter_phone">Phone number</Label>
          <Input
            id="reporter_phone"
            name="reporter_phone"
            required
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            enterKeyHint="next"
            value={reporterPhone}
            onChange={(e) => setReporterPhone(e.target.value)}
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

        <div className="flex flex-col gap-2">
          <Label>Incident type</Label>
          <Select value={incidentTypeId} onValueChange={setIncidentTypeId} required>
            <SelectTrigger>
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
        </div>

        <div className="flex flex-col gap-2">
          <Label>Severity</Label>
          <Select value={severityLevelId} onValueChange={setSeverityLevelId} required>
            <SelectTrigger>
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
            placeholder="Describe what happened in as much detail as you can. Who was involved? What was done?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-32 text-base"
          />
        </div>

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
