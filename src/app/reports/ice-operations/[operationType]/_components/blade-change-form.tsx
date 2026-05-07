"use client"

import { useActionState, useEffect, useMemo, useState } from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import {
  submitIceOperationsReport,
  type SubmissionFormState,
} from "../../actions"
import {
  equipmentLabel,
  nowForDateTimeLocal,
  type EmployeeOption,
  type EquipmentOption,
  type RinkOption,
} from "./shared"

type Props = {
  rinks: RinkOption[]
  equipment: EquipmentOption[]
  employees: EmployeeOption[]
  currentEmployeeId: string
}

const initialState: SubmissionFormState = {}

export function BladeChangeForm({
  rinks,
  equipment,
  employees,
  currentEmployeeId,
}: Props) {
  const action = submitIceOperationsReport.bind(null, "blade_change")
  const [state, formAction] = useActionState(action, initialState)

  const defaultOccurredAt = useMemo(() => nowForDateTimeLocal(), [])
  const [rinkId, setRinkId] = useState("")
  const [equipmentId, setEquipmentId] = useState("")
  const [occurredAt, setOccurredAt] = useState(defaultOccurredAt)
  const [bladeSerial, setBladeSerial] = useState("")
  const [hoursAtChange, setHoursAtChange] = useState("")
  const [replacedBy, setReplacedBy] = useState(currentEmployeeId)
  const [notes, setNotes] = useState("")

  useEffect(() => {
    if (state.error) toast.error(state.error)
  }, [state.error])

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormError message={state.error} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="rink_id">Rink (optional)</Label>
        <select
          id="rink_id"
          name="rink_id"
          value={rinkId}
          onChange={(e) => setRinkId(e.target.value)}
          className="border-input bg-background focus-visible:ring-ring/50 focus-visible:border-ring h-12 w-full rounded-md border px-3 text-base shadow-xs outline-none focus-visible:ring-[3px]"
        >
          <option value="">— None —</option>
          {rinks.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="equipment_id">Blade set</Label>
        <select
          id="equipment_id"
          name="equipment_id"
          required
          value={equipmentId}
          onChange={(e) => setEquipmentId(e.target.value)}
          className="border-input bg-background focus-visible:ring-ring/50 focus-visible:border-ring h-12 w-full rounded-md border px-3 text-base shadow-xs outline-none focus-visible:ring-[3px]"
        >
          <option value="" disabled>
            Select a blade set
          </option>
          {equipment.map((eq) => (
            <option key={eq.id} value={eq.id}>
              {equipmentLabel(eq)}
            </option>
          ))}
        </select>
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
        <Label htmlFor="blade_serial">Blade serial</Label>
        <Input
          id="blade_serial"
          name="blade_serial"
          type="text"
          inputMode="text"
          value={bladeSerial}
          onChange={(e) => setBladeSerial(e.target.value)}
          className="h-12 text-base"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="hours_at_change">Hours at change</Label>
        <Input
          id="hours_at_change"
          name="hours_at_change"
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={hoursAtChange}
          onChange={(e) => setHoursAtChange(e.target.value)}
          className="h-12 text-base"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="replaced_by_employee_id">Replaced by</Label>
        <select
          id="replaced_by_employee_id"
          name="replaced_by_employee_id"
          value={replacedBy}
          onChange={(e) => setReplacedBy(e.target.value)}
          className="border-input bg-background focus-visible:ring-ring/50 focus-visible:border-ring h-12 w-full rounded-md border px-3 text-base shadow-xs outline-none focus-visible:ring-[3px]"
        >
          <option value="">— Unknown —</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.name}
            </option>
          ))}
        </select>
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
      {pending ? "Submitting…" : "Submit blade change"}
    </Button>
  )
}
