"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

import { cancelTimeOffRequest } from "../actions"
import { INITIAL_ACTION_STATE } from "../types"

export function CancelTimeOffButton({ id }: { id: string }) {
  const [state, formAction, isPending] = useActionState(
    cancelTimeOffRequest,
    INITIAL_ACTION_STATE
  )
  const formRef = useRef<HTMLFormElement>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    if (state.status === "error") {
      toast.error(state.error)
    } else if (state.status === "success") {
      toast.success(state.message ?? "Cancelled.")
    }
  }, [state])

  return (
    <form ref={formRef} action={formAction}>
      <input type="hidden" name="id" value={id} />
      {/* AlertDialogContent is portaled outside this form, so the confirm
          button submits via formRef.requestSubmit() rather than type="submit". */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            className="h-11"
          >
            {isPending ? "Cancelling…" : "Cancel request"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this time-off request?</AlertDialogTitle>
            <AlertDialogDescription>
              This withdraws your time-off request.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmOpen(false)}>
              Keep request
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false)
                formRef.current?.requestSubmit()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancel request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  )
}
