"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

import { cancelShiftDrop, requestShiftDrop } from "../actions"
import { INITIAL_ACTION_STATE } from "../types"

// These call the server actions through useTransition rather than
// useActionState so success can imperatively close the dialog and refresh —
// the same shape as admin/scheduling/shifts/_components/publish-button.tsx.
// (Reacting to the result inside an effect would mean setState-in-effect.)

/**
 * Ask to be released from one of your own shifts. Confirms first — a drop
 * notifies managers and, once approved, takes the shift off your schedule, so
 * it should never fire on a stray tap. The optional reason goes straight to
 * whoever reviews it.
 */
export function DropShiftButton({
  shiftId,
  requiresApproval,
}: {
  shiftId: string
  /** Facility setting — drives the confirm copy so people know what happens. */
  requiresApproval: boolean
}) {
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const router = useRouter()

  function submit() {
    start(async () => {
      const formData = new FormData()
      formData.set("shift_id", shiftId)
      formData.set("reason", reason)
      const res = await requestShiftDrop(INITIAL_ACTION_STATE, formData)
      if (res.status === "error") {
        toast.error(res.error)
        return
      }
      toast.success(
        res.status === "success" && res.message ? res.message : "Drop requested."
      )
      setOpen(false)
      setReason("")
      router.refresh()
    })
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={() => setOpen(true)}
      >
        Drop
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Drop this shift?</AlertDialogTitle>
            <AlertDialogDescription>
              {requiresApproval
                ? "Your manager will be asked to approve. You're still on the shift until they do."
                : "This releases the shift immediately — it goes to the open list for a coworker to pick up."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
              Reason (optional)
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Anything your manager should know"
              className="rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--ring)]/40"
            />
          </label>

          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={pending}>
              Keep shift
            </AlertDialogCancel>
            <Button type="button" disabled={pending} onClick={submit}>
              {pending
                ? "Sending…"
                : requiresApproval
                  ? "Request drop"
                  : "Drop shift"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** Withdraw a still-pending drop request. */
export function CancelDropButton({ dropId }: { dropId: string }) {
  const [pending, start] = useTransition()
  const router = useRouter()

  function submit() {
    start(async () => {
      const formData = new FormData()
      formData.set("drop_id", dropId)
      const res = await cancelShiftDrop(INITIAL_ACTION_STATE, formData)
      if (res.status === "error") {
        toast.error(res.error)
        return
      }
      toast.success(
        res.status === "success" && res.message
          ? res.message
          : "Drop request withdrawn."
      )
      router.refresh()
    })
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="shrink-0"
      disabled={pending}
      onClick={submit}
    >
      {pending ? "Withdrawing…" : "Withdraw"}
    </Button>
  )
}
