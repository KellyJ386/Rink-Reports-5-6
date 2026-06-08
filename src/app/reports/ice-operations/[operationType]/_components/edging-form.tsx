"use client"

import { useActionState, useEffect, useMemo, useState } from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import { Button } from "@/components/ui/button"
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
  submitIceOperationsReport,
  type SubmissionFormState,
} from "../../actions"
import { OfflineQueuedCard } from "./offline-queued-card"
import {
  equipmentLabel,
  nowForDateTimeLocal,
  type EquipmentOption,
} from "./shared"
import { useOfflineSubmit } from "./use-offline-submit"

type Props = {
  equipment: EquipmentOption[]
}

const initialState: SubmissionFormState = {}

export function EdgingForm({ equipment }: Props) {
  const action = submitIceOperationsReport.bind(null, "edging")
  const [state, formAction] = useActionState(action, initialState)

  const occurredAt = useMemo(() => nowForDateTimeLocal(), [])
  const [equipmentId, setEquipmentId] = useState("")
  const [hoursRun, setHoursRun] = useState("")
  const [notes, setNotes] = useState("")

  const { queued, handleSubmit } = useOfflineSubmit("edging", () => ({
    equipment_id: equipmentId || null,
    occurred_at: occurredAt,
    notes: notes.trim() || null,
    hours_run: hoursRun,
  }))

  useEffect(() => {
    if (state.error) toast.error(state.error)
  }, [state.error])

  if (queued) return <OfflineQueuedCard />

  return (
    <form
      action={formAction}
      onSubmit={handleSubmit}
      className="flex flex-col gap-5"
    >
      <FormError message={state.error} />

      <input type="hidden" name="occurred_at" value={occurredAt} />
      <input type="hidden" name="equipment_id" value={equipmentId} />

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label>
            Machine
            <RequiredMark />
          </Label>
          <Select value={equipmentId} onValueChange={setEquipmentId} required>
            <SelectTrigger>
              <SelectValue placeholder="Select machine" />
            </SelectTrigger>
            <SelectContent>
              {equipment.map((eq) => (
                <SelectItem key={eq.id} value={eq.id}>
                  {equipmentLabel(eq)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="hours_run">Hours Run</Label>
          <Input
            id="hours_run"
            name="hours_run"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            placeholder="0.00"
            value={hoursRun}
            onChange={(e) => setHoursRun(e.target.value)}
            className="h-12 text-base"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={4}
          placeholder="Add any additional notes..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="min-h-24 text-base"
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
      {pending ? "Submitting…" : "Submit edging report"}
    </Button>
  )
}
