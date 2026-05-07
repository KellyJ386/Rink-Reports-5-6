"use client"

import { useActionState, useEffect, useMemo, useState } from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import { submitTimeOffRequest } from "../actions"
import { INITIAL_ACTION_STATE } from "../types"

function nowForDateTimeLocal(offsetHours = 0): string {
  const d = new Date()
  d.setHours(d.getHours() + offsetHours)
  d.setMinutes(0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
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
      {pending ? "Submitting…" : "Submit request"}
    </Button>
  )
}

export function TimeOffForm() {
  const [state, formAction] = useActionState(
    submitTimeOffRequest,
    INITIAL_ACTION_STATE
  )
  const defaultStart = useMemo(() => nowForDateTimeLocal(24), [])
  const defaultEnd = useMemo(() => nowForDateTimeLocal(48), [])
  const [startsAt, setStartsAt] = useState(defaultStart)
  const [endsAt, setEndsAt] = useState(defaultEnd)
  const [reason, setReason] = useState("")
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (state.status === "error") {
      toast.error(state.error)
    } else if (state.status === "success") {
      toast.success(state.message ?? "Submitted.")
      queueMicrotask(() => {
        setOpen(false)
        setReason("")
      })
    }
  }, [state])

  if (!open) {
    return (
      <Button
        type="button"
        size="lg"
        onClick={() => setOpen(true)}
        className="h-12 w-full text-base sm:w-auto"
      >
        New request
      </Button>
    )
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-xl border bg-card p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">New time-off request</h3>
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
      <div className="flex flex-col gap-2">
        <Label htmlFor="starts_at">Starts</Label>
        <Input
          id="starts_at"
          name="starts_at"
          type="datetime-local"
          required
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          className="h-12 text-base"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="ends_at">Ends</Label>
        <Input
          id="ends_at"
          name="ends_at"
          type="datetime-local"
          required
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
          className="h-12 text-base"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="reason">Reason (optional)</Label>
        <Textarea
          id="reason"
          name="reason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Anything your manager should know"
          className="text-base"
        />
      </div>
      <Submit />
    </form>
  )
}
