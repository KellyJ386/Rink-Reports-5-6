"use client"

import { useActionState, useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
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
import { enqueueSubmission } from "@/lib/offline/use-sync-queue"
import { genLocalId } from "@/lib/offline/local-id"

import { upsertAvailability } from "../actions"
import {
  DAY_NAMES,
  INITIAL_ACTION_STATE,
  type JobAreaOption,
} from "../types"

const NO_AREA = "__none__"

type Props = {
  initial?: {
    id: string
    day_of_week: number
    start_time: string
    end_time: string
    availability_type: string
    effective_from: string | null
    effective_to: string | null
    notes: string | null
    job_area_id?: string | null
  } | null
  onClose?: () => void
  // Job areas the employee can pick from. Empty => no area picker.
  jobAreas?: JobAreaOption[]
  // When set, the form is locked to this day_of_week (the day-detail view) and
  // hides the day picker.
  fixedDay?: number
}

function Submit({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending}
      className="h-12 w-full text-base"
    >
      {pending ? "Saving…" : isEdit ? "Save changes" : "Add availability"}
    </Button>
  )
}

function timeToHHMM(value: string): string {
  // input "HH:MM:SS" -> "HH:MM"
  const m = value.match(/^(\d{2}):(\d{2})/)
  return m ? `${m[1]}:${m[2]}` : value
}

export function AvailabilityForm({
  initial,
  onClose,
  jobAreas = [],
  fixedDay,
}: Props) {
  const [state, formAction] = useActionState(
    upsertAvailability,
    INITIAL_ACTION_STATE
  )
  const isEdit = Boolean(initial)
  const [day, setDay] = useState(
    String(fixedDay ?? initial?.day_of_week ?? 1)
  )
  const [startTime, setStartTime] = useState(
    initial ? timeToHHMM(initial.start_time) : "09:00"
  )
  const [endTime, setEndTime] = useState(
    initial ? timeToHHMM(initial.end_time) : "17:00"
  )
  const [type, setType] = useState(initial?.availability_type ?? "available")
  const [from, setFrom] = useState(initial?.effective_from ?? "")
  const [to, setTo] = useState(initial?.effective_to ?? "")
  const [notes, setNotes] = useState(initial?.notes ?? "")
  const [jobAreaId, setJobAreaId] = useState(initial?.job_area_id ?? "")
  const [localId, setLocalId] = useState(genLocalId)

  useEffect(() => {
    if (state.status === "error") {
      toast.error(state.error)
    } else if (state.status === "success") {
      toast.success(state.message ?? "Saved.")
      if (onClose) onClose()
    }
  }, [state, onClose])

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        // Offline: queue in the service worker; it replays to /api/offline-sync
        // (which re-validates + persists) once back online.
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          const ok = enqueueSubmission({
            localId,
            moduleKey: "scheduling",
            action: "submit_availability",
            payload: {
              id: initial?.id ?? "",
              day_of_week: Number(day),
              start_time: startTime,
              end_time: endTime,
              availability_type: type,
              effective_from: from,
              effective_to: to,
              notes,
              job_area_id: jobAreaId,
            },
          })
          if (ok) {
            e.preventDefault()
            setLocalId(genLocalId())
            toast.success("Saved offline — will sync when you're back online.")
            if (onClose) onClose()
          }
        }
      }}
      className="flex flex-col gap-4 rounded-xl border bg-card p-4"
    >
      {initial?.id ? (
        <input type="hidden" name="id" value={initial.id} />
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">
          {isEdit ? "Edit availability" : "New availability"}
        </h3>
        {onClose ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
          >
            Cancel
          </Button>
        ) : null}
      </div>
      <FormError
        message={state.status === "error" ? state.error : undefined}
      />
      <input type="hidden" name="day_of_week" value={day} />
      <input type="hidden" name="availability_type" value={type} />
      <input type="hidden" name="job_area_id" value={jobAreaId} />

      {fixedDay === undefined ? (
        <div className="flex flex-col gap-2">
          <Label id="avail-day-label">Day of week</Label>
          <Select value={day} onValueChange={setDay}>
            <SelectTrigger aria-labelledby="avail-day-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAY_NAMES.map((name, idx) => (
                <SelectItem key={name} value={String(idx)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="start_time">Start time</Label>
          <Input
            id="start_time"
            name="start_time"
            type="time"
            required
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="h-12 text-base"
          />
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="end_time">End time</Label>
          <Input
            id="end_time"
            name="end_time"
            type="time"
            required
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="h-12 text-base"
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label id="avail-type-label">Type</Label>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger aria-labelledby="avail-type-label">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="preferred">Preferred</SelectItem>
            <SelectItem value="unavailable">Unavailable</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {jobAreas.length > 0 ? (
        <div className="flex flex-col gap-2">
          <Label id="avail-area-label">Area / department you want to work</Label>
          <Select
            value={jobAreaId === "" ? NO_AREA : jobAreaId}
            onValueChange={(v) => setJobAreaId(v === NO_AREA ? "" : v)}
          >
            <SelectTrigger aria-labelledby="avail-area-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_AREA}>No preference</SelectItem>
              {jobAreas.map((area) => (
                <SelectItem key={area.id} value={area.id}>
                  {area.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="effective_from">Effective from (optional)</Label>
          <Input
            id="effective_from"
            name="effective_from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-12 text-base"
          />
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="effective_to">Effective to (optional)</Label>
          <Input
            id="effective_to"
            name="effective_to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-12 text-base"
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="text-base"
        />
      </div>
      <Submit isEdit={isEdit} />
    </form>
  )
}
