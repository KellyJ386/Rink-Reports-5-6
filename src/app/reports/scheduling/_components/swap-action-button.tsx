"use client"

import { useActionState, useEffect } from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { acceptSwapRequest, cancelSwapRequest } from "../actions"
import { INITIAL_ACTION_STATE } from "../types"

type Action = "accept" | "cancel"

function Submit({
  action,
  pendingLabel,
  label,
  variant,
}: {
  action: Action
  pendingLabel: string
  label: string
  variant: "default" | "outline"
}) {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      variant={variant}
      size="sm"
      disabled={pending}
      className="h-11"
      data-action={action}
    >
      {pending ? pendingLabel : label}
    </Button>
  )
}

export function SwapAcceptButton({ id }: { id: string }) {
  const [state, formAction] = useActionState(
    acceptSwapRequest,
    INITIAL_ACTION_STATE
  )
  useEffect(() => {
    if (state.status === "error") toast.error(state.error)
    else if (state.status === "success") toast.success(state.message ?? "Accepted.")
  }, [state])
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <Submit
        action="accept"
        label="Accept"
        pendingLabel="Accepting…"
        variant="default"
      />
    </form>
  )
}

export function SwapCancelButton({ id }: { id: string }) {
  const [state, formAction] = useActionState(
    cancelSwapRequest,
    INITIAL_ACTION_STATE
  )
  useEffect(() => {
    if (state.status === "error") toast.error(state.error)
    else if (state.status === "success") toast.success(state.message ?? "Cancelled.")
  }, [state])
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <Submit
        action="cancel"
        label="Cancel"
        pendingLabel="Cancelling…"
        variant="outline"
      />
    </form>
  )
}
