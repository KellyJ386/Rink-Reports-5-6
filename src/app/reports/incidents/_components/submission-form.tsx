"use client"

import { useEffect, useMemo, useState } from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

/**
 * Build a default value for a `datetime-local` input from "now". The input
 * expects `YYYY-MM-DDTHH:mm` in the user's local time, so we manually format
 * rather than using `toISOString()` (which is UTC).
 */
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
  const [state, formAction] = useActionState(
    submitIncidentReport,
    initialState
  )

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

  return (
    <form action={formAction} className="flex flex-col gap-5">
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
        <Label htmlFor="incident_type_id">Incident type</Label>
        <select
          id="incident_type_id"
          name="incident_type_id"
          required
          value={incidentTypeId}
          onChange={(e) => setIncidentTypeId(e.target.value)}
          className="border-input bg-background focus-visible:ring-ring/50 focus-visible:border-ring h-12 w-full rounded-md border px-3 text-base shadow-xs outline-none focus-visible:ring-[3px]"
        >
          <option value="" disabled>
            Select an incident type
          </option>
          {incidentTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="severity_level_id">Severity</Label>
        <select
          id="severity_level_id"
          name="severity_level_id"
          required
          value={severityLevelId}
          onChange={(e) => setSeverityLevelId(e.target.value)}
          className="border-input bg-background focus-visible:ring-ring/50 focus-visible:border-ring h-12 w-full rounded-md border px-3 text-base shadow-xs outline-none focus-visible:ring-[3px]"
        >
          <option value="" disabled>
            Select severity
          </option>
          {severityLevels.map((s) => (
            <option key={s.id} value={s.id}>
              {s.display_name}
            </option>
          ))}
        </select>
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

      <SubmitBar />
    </form>
  )
}

function SubmitBar() {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending}
      className="h-12 w-full text-base"
    >
      {pending ? "Submitting…" : "Submit incident report"}
    </Button>
  )
}
