"use client"

import { useActionState, useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

import { submitSwapRequest } from "../actions"
import { INITIAL_ACTION_STATE } from "../types"
import { formatDateRange } from "./format-utils"

type ShiftOption = {
  id: string
  starts_at: string
  ends_at: string
  role_label: string | null
  department_name: string | null
}

type CoworkerOption = {
  id: string
  label: string
}

type CoworkerShiftOption = {
  id: string
  employee_id: string
  starts_at: string
  ends_at: string
  role_label: string | null
}

type Props = {
  myShifts: ShiftOption[]
  coworkers: CoworkerOption[]
  coworkerShifts: CoworkerShiftOption[]
  timezone: string | null
}

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending}
      className="h-12 w-full text-base"
    >
      {pending ? "Sending…" : "Send swap request"}
    </Button>
  )
}

export function SwapForm({
  myShifts,
  coworkers,
  coworkerShifts,
  timezone,
}: Props) {
  const [state, formAction] = useActionState(
    submitSwapRequest,
    INITIAL_ACTION_STATE
  )
  const [open, setOpen] = useState(false)
  const [shiftId, setShiftId] = useState("")
  const [targetEmpId, setTargetEmpId] = useState("")
  const [targetShiftId, setTargetShiftId] = useState("")
  const [note, setNote] = useState("")

  const targetCoworkerShifts = coworkerShifts.filter(
    (s) => s.employee_id === targetEmpId
  )

  useEffect(() => {
    if (state.status === "error") {
      toast.error(state.error)
    } else if (state.status === "success") {
      toast.success(state.message ?? "Sent.")
      queueMicrotask(() => {
        setOpen(false)
        setShiftId("")
        setTargetEmpId("")
        setTargetShiftId("")
        setNote("")
      })
    }
  }, [state])

  if (!open) {
    return (
      <Button
        type="button"
        size="lg"
        onClick={() => setOpen(true)}
        disabled={myShifts.length === 0}
        className="h-12 w-full text-base sm:w-auto"
      >
        New swap request
      </Button>
    )
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-xl border bg-card p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">New swap request</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
      <FormError
        message={state.status === "error" ? state.error : undefined}
      />
      <input type="hidden" name="requester_shift_id" value={shiftId} />
      <input type="hidden" name="target_employee_id" value={targetEmpId} />

      <div className="flex flex-col gap-2">
        <Label id="swap-my-shift-label">Your shift to give up</Label>
        <Select value={shiftId} onValueChange={setShiftId} required>
          <SelectTrigger aria-labelledby="swap-my-shift-label">
            <SelectValue placeholder="Pick a shift" />
          </SelectTrigger>
          <SelectContent>
            {myShifts.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {formatDateRange(s.starts_at, s.ends_at, timezone)}
                {s.department_name ? ` — ${s.department_name}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label id="swap-coworker-label">Coworker (optional)</Label>
        <Select
          value={targetEmpId || undefined}
          onValueChange={(v) => {
            setTargetEmpId(v)
            setTargetShiftId("")
          }}
        >
          <SelectTrigger aria-labelledby="swap-coworker-label">
            <SelectValue placeholder="Anyone" />
          </SelectTrigger>
          <SelectContent>
            {coworkers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {targetEmpId ? (
        <div className="flex flex-col gap-2">
          <Label id="swap-target-shift-label">
            Their shift to take (optional)
          </Label>
          <input type="hidden" name="target_shift_id" value={targetShiftId} />
          {targetCoworkerShifts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No upcoming shifts for this coworker — leave blank to just give
              your shift away.
            </p>
          ) : (
            <Select
              value={targetShiftId || undefined}
              onValueChange={setTargetShiftId}
            >
              <SelectTrigger aria-labelledby="swap-target-shift-label">
                <SelectValue placeholder="Just cover mine (no trade)" />
              </SelectTrigger>
              <SelectContent>
                {targetCoworkerShifts.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {formatDateRange(s.starts_at, s.ends_at, timezone)}
                    {s.role_label ? ` — ${s.role_label}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      ) : (
        <input type="hidden" name="target_shift_id" value="" />
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="decision_note">Note (optional)</Label>
        <Textarea
          id="decision_note"
          name="decision_note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="text-base"
        />
      </div>
      <Submit />
    </form>
  )
}
