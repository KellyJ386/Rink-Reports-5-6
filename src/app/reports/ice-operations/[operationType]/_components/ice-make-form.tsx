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
import { useSelectedRink } from "@/lib/ice-operations/rink-selection"

import {
  submitIceOperationsReport,
  type SubmissionFormState,
} from "../../actions"
import type { TemperatureUnit } from "../../types"
import {
  equipmentLabel,
  nowForDateTimeLocal,
  type EquipmentOption,
  type RinkOption,
} from "./shared"

type Props = {
  facilityId: string
  rinks: RinkOption[]
  equipment: EquipmentOption[]
  temperatureUnit: TemperatureUnit
}

const initialState: SubmissionFormState = {}

export function IceMakeForm({
  facilityId,
  rinks,
  equipment,
  temperatureUnit,
}: Props) {
  const action = submitIceOperationsReport.bind(null, "ice_make")
  const [state, formAction] = useActionState(action, initialState)

  const defaultOccurredAt = useMemo(() => nowForDateTimeLocal(), [])
  const [storedRinkId, setRinkId] = useSelectedRink(facilityId)
  const rinkId = rinks.some((r) => r.id === storedRinkId) ? storedRinkId : ""
  const [equipmentId, setEquipmentId] = useState("")
  const [occurredAt, setOccurredAt] = useState(defaultOccurredAt)
  const [waterTemp, setWaterTemp] = useState("")
  const [iceTemp, setIceTemp] = useState("")
  const [timeIn, setTimeIn] = useState("")
  const [timeOut, setTimeOut] = useState("")
  const [waterUsed, setWaterUsed] = useState("")
  const [passes, setPasses] = useState("")
  const [notes, setNotes] = useState("")

  useEffect(() => {
    if (state.error) toast.error(state.error)
  }, [state.error])

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormError message={state.error} />
      <input
        type="hidden"
        name="temperature_unit"
        value={temperatureUnit}
      />

      <input type="hidden" name="rink_id" value={rinkId} />
      <input type="hidden" name="equipment_id" value={equipmentId} />

      <div className="flex flex-col gap-2">
        <Label>Rink<RequiredMark /></Label>
        <Select value={rinkId} onValueChange={setRinkId} required>
          <SelectTrigger>
            <SelectValue placeholder="Select a rink" />
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
        <Label>Ice Resurfacer<RequiredMark /></Label>
        <Select value={equipmentId} onValueChange={setEquipmentId} required>
          <SelectTrigger>
            <SelectValue placeholder="Select an ice resurfacer" />
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
        <Label htmlFor="occurred_at">When did it happen?<RequiredMark /></Label>
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="water_temp">Water temp (°{temperatureUnit})</Label>
          <Input
            id="water_temp"
            name="water_temp"
            type="number"
            inputMode="decimal"
            step="any"
            value={waterTemp}
            onChange={(e) => setWaterTemp(e.target.value)}
            className="h-12 text-base"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ice_temp">Ice temp (°{temperatureUnit})</Label>
          <Input
            id="ice_temp"
            name="ice_temp"
            type="number"
            inputMode="decimal"
            step="any"
            value={iceTemp}
            onChange={(e) => setIceTemp(e.target.value)}
            className="h-12 text-base"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="time_in">Time in</Label>
          <Input
            id="time_in"
            name="time_in"
            type="time"
            value={timeIn}
            onChange={(e) => setTimeIn(e.target.value)}
            className="h-12 text-base"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="time_out">Time out</Label>
          <Input
            id="time_out"
            name="time_out"
            type="time"
            value={timeOut}
            onChange={(e) => setTimeOut(e.target.value)}
            className="h-12 text-base"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="water_used_gal">Water used (gal)</Label>
          <Input
            id="water_used_gal"
            name="water_used_gal"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={waterUsed}
            onChange={(e) => setWaterUsed(e.target.value)}
            className="h-12 text-base"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="surface_pass_count">Surface passes</Label>
          <Input
            id="surface_pass_count"
            name="surface_pass_count"
            type="number"
            inputMode="numeric"
            step="1"
            min="0"
            value={passes}
            onChange={(e) => setPasses(e.target.value)}
            className="h-12 text-base"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={4}
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
      {pending ? "Submitting…" : "Submit ice make"}
    </Button>
  )
}
