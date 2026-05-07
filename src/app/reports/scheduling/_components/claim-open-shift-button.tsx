"use client"

import { useActionState, useEffect } from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { claimOpenShift } from "../actions"
import { INITIAL_ACTION_STATE } from "../types"

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      size="sm"
      disabled={pending}
      className="h-11 w-full sm:w-auto"
    >
      {pending ? "Claiming…" : "Claim shift"}
    </Button>
  )
}

export function ClaimOpenShiftButton({
  openShiftId,
}: {
  openShiftId: string
}) {
  const [state, formAction] = useActionState(claimOpenShift, INITIAL_ACTION_STATE)

  useEffect(() => {
    if (state.status === "error") {
      toast.error(state.error)
    } else if (state.status === "success" && state.message) {
      toast.success(state.message)
    }
  }, [state])

  return (
    <form action={formAction} className="flex w-full">
      <input type="hidden" name="open_shift_id" value={openShiftId} />
      <Submit />
    </form>
  )
}
