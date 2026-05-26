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
import {
  equipmentLabel,
  nowForDateTimeLocal,
  type EquipmentOption,
  type RinkOption,
} from "./shared"

type Props = {
  rinks: RinkOption[]
  equipment: EquipmentOption[]
}

const initialState: SubmissionFormState = {}

export function IceMakeForm({ rinks, equipment }: Props) {
  const action = submitIceOperationsReport.bind(null, "ice_make")
  const [state, formAction] = useActionState(action, initialState)

  const occurredAt = useMemo(() => nowForDateTimeLocal(), [])
  const [rinkId, setRinkId] = useState("")
  const [equipmentId, setEquipmentId] = useState("")
  const [waterUsed, setWaterUsed] = useState("")
  const [machineHours, setMachineHours] = useState("")
  const [snowTaken, setSnowTaken] = useState("")
  const [timeOn, setTimeOn] = useState("")
  const [timeOff, setTimeOff] = useState("")
  const [notes, setNotes] = useState("")

  useEffect(() => {
    if (state.error) toast.error(state.error)
  }, [state.error])

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormError message={state.error} />

      <input type="hidden" name="occurred_at" value={occurredAt} />
      <input type="hidden" name="rink_id" value={rinkId} />
      <input type="hidden" name="equipment_id" value={equipmentId} />
      <input type="hidden" name="time_in" value={timeOn} />
      <input type="hidden" name="time_out" value={timeOff} />

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label>
            Rink
            <RequiredMark />
          </Label>
          <Select value={rinkId} onValueChange={setRinkId} required>
            <SelectTrigger>
              <SelectValue placeholder="Select rink" />
            </SelectTrigger>
            <SelectContent>
              {rinks.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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
          <Label htmlFor="water_used_gal">Water Used (gallons)</Label>
          <Input
            id="water_used_gal"
            name="water_used_gal"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            placeholder="0.00"
            value={waterUsed}
            onChange={(e) => setWaterUsed(e.target.value)}
            className="h-12 text-base"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="machine_hours">Machine Hours</Label>
          <Input
            id="machine_hours"
            name="machine_hours"
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

        <div className="flex flex-col gap-2">
          <Label htmlFor="snow_taken_pct">Snow Taken (%)</Label>
          <Input
            id="snow_taken_pct"
            name="snow_taken_pct"
            type="number"
            inputMode="numeric"
            step="1"
            min="0"
            max="100"
            placeholder="0-100"
            value={snowTaken}
            onChange={(e) => setSnowTaken(e.target.value)}
            className="h-12 text-base"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="time_on">Time On</Label>
          <Input
            id="time_on"
            type="time"
            value={timeOn}
            onChange={(e) => setTimeOn(e.target.value)}
            className="h-12 text-base"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="time_off">Time Off</Label>
          <Input
            id="time_off"
            type="time"
            value={timeOff}
            onChange={(e) => setTimeOff(e.target.value)}
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
      {pending ? "Submitting…" : "Submit resurface"}
    </Button>
  )
}
