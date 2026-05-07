"use client"

import { useActionState, useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import { upsertAvailability } from "../actions"
import { DAY_NAMES, INITIAL_ACTION_STATE } from "../types"

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
  } | null
  onClose?: () => void
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

export function AvailabilityForm({ initial, onClose }: Props) {
  const [state, formAction] = useActionState(
    upsertAvailability,
    INITIAL_ACTION_STATE
  )
  const isEdit = Boolean(initial)
  const [day, setDay] = useState(String(initial?.day_of_week ?? 1))
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
      <div className="flex flex-col gap-2">
        <Label htmlFor="day_of_week">Day of week</Label>
        <select
          id="day_of_week"
          name="day_of_week"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className="border-input bg-background h-12 w-full rounded-md border px-3 text-base shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {DAY_NAMES.map((name, idx) => (
            <option key={name} value={String(idx)}>
              {name}
            </option>
          ))}
        </select>
      </div>
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
        <Label htmlFor="availability_type">Type</Label>
        <select
          id="availability_type"
          name="availability_type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="border-input bg-background h-12 w-full rounded-md border px-3 text-base shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="available">Available</option>
          <option value="preferred">Preferred</option>
          <option value="unavailable">Unavailable</option>
        </select>
      </div>
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
