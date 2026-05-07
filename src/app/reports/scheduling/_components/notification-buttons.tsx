"use client"

import { useActionState, useEffect } from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import {
  markAllNotificationsRead,
  markNotificationRead,
} from "../actions"
import { INITIAL_ACTION_STATE } from "../types"

function MarkSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      variant="outline"
      size="sm"
      disabled={pending}
      className="h-11"
    >
      {pending ? "Marking…" : label}
    </Button>
  )
}

export function MarkReadButton({ id }: { id: string }) {
  const [state, formAction] = useActionState(
    markNotificationRead,
    INITIAL_ACTION_STATE
  )
  useEffect(() => {
    if (state.status === "error") toast.error(state.error)
  }, [state])
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <MarkSubmit label="Mark read" />
    </form>
  )
}

export function MarkAllReadButton({ disabled }: { disabled: boolean }) {
  const [state, formAction] = useActionState(
    markAllNotificationsRead,
    INITIAL_ACTION_STATE
  )
  useEffect(() => {
    if (state.status === "error") toast.error(state.error)
    else if (state.status === "success" && state.message)
      toast.success(state.message)
  }, [state])
  return (
    <form action={formAction}>
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={disabled}
        className="h-11"
      >
        Mark all read
      </Button>
    </form>
  )
}
