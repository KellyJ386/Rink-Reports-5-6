"use client"

import { useActionState, useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { useHydrated } from "@/components/app/local-datetime"
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
import { equipmentLabel, type EquipmentOption } from "./shared"
import { useOfflineSubmit } from "./use-offline-submit"

type Props = {
  equipment: EquipmentOption[]
}

const initialState: SubmissionFormState = {}

export function PropaneTankChangeForm({ equipment }: Props) {
  const action = submitIceOperationsReport.bind(null, "propane_tank_change")
  const [state, formAction] = useActionState(action, initialState)

  const [equipmentId, setEquipmentId] = useState("")
  const [machineHours, setMachineHours] = useState("")
  const [notes, setNotes] = useState("")

  // Display-only: the date is auto-captured (occurred_at is stamped at submit
  // time — hook for offline, server for online). Deferred until hydration so
  // the SSR pass and the client agree even across a midnight/timezone boundary.
  const hydrated = useHydrated()
  const today = hydrated
    ? new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : ""

  const { queued, handleSubmit } = useOfflineSubmit(
    "propane_tank_change",
    () => ({
      equipment_id: equipmentId || null,
      notes: notes.trim() || null,
      hours_at_change: machineHours,
    }),
  )

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
          <Label htmlFor="hours_at_change">Machine Hours</Label>
          <Input
            id="hours_at_change"
            name="hours_at_change"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            placeholder="0.00"
            value={machineHours}
            onChange={(e) => setMachineHours(e.target.value)}
            className="h-12 text-base"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="propane_date">Date</Label>
        <Input
          id="propane_date"
          type="text"
          value={today}
          disabled
          className="h-12 text-base"
        />
        <p className="text-sm text-muted-foreground">
          Recorded automatically when you submit.
        </p>
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
      {pending ? "Submitting…" : "Submit propane tank change"}
    </Button>
  )
}
