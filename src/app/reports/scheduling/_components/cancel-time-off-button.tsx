"use client"

import { useActionState, useEffect } from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { cancelTimeOffRequest } from "../actions"
import { INITIAL_ACTION_STATE } from "../types"

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      variant="outline"
      size="sm"
      disabled={pending}
      className="h-11"
    >
      {pending ? "Cancelling…" : "Cancel request"}
    </Button>
  )
}

export function CancelTimeOffButton({ id }: { id: string }) {
  const [state, formAction] = useActionState(
    cancelTimeOffRequest,
    INITIAL_ACTION_STATE
  )

  useEffect(() => {
    if (state.status === "error") {
      toast.error(state.error)
    } else if (state.status === "success") {
      toast.success(state.message ?? "Cancelled.")
    }
  }, [state])

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <Submit />
    </form>
  )
}
