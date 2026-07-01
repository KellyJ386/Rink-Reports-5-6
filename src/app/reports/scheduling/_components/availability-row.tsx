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
import { Badge, type BadgeProps } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import { deleteAvailability } from "../actions"
import { INITIAL_ACTION_STATE, type JobAreaOption } from "../types"
import { formatTimeOnly } from "./format-utils"
import { AvailabilityForm } from "./availability-form"

type Row = {
  id: string
  day_of_week: number
  start_time: string
  end_time: string
  availability_type: string
  effective_from: string | null
  effective_to: string | null
  notes: string | null
  job_area_id?: string | null
  job_area_name?: string | null
}

function typeBadgeVariant(type: string): BadgeProps["variant"] {
  switch (type) {
    case "preferred":
      return "success"
    case "unavailable":
      return "error"
    default:
      return "info"
  }
}

export function AvailabilityRow({
  row,
  jobAreas = [],
}: {
  row: Row
  jobAreas?: JobAreaOption[]
}) {
  const [editing, setEditing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const [state, formAction, isPending] = useActionState(
    deleteAvailability,
    INITIAL_ACTION_STATE
  )

  useEffect(() => {
    if (state.status === "error") {
      toast.error(state.error)
    } else if (state.status === "success") {
      toast.success(state.message ?? "Removed.")
    }
  }, [state])

  if (editing) {
    return (
      <AvailabilityForm
        initial={row}
        onClose={() => setEditing(false)}
        jobAreas={jobAreas}
        fixedDay={row.day_of_week}
      />
    )
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {formatTimeOnly(row.start_time)} – {formatTimeOnly(row.end_time)}
        </span>
        <Badge variant={typeBadgeVariant(row.availability_type)} className="capitalize">
          {row.availability_type}
        </Badge>
      </div>
      {row.job_area_name ? (
        <p className="text-xs text-muted-foreground">
          Area: <span className="font-medium">{row.job_area_name}</span>
        </p>
      ) : null}
      {row.effective_from || row.effective_to ? (
        <p className="text-xs text-muted-foreground">
          {row.effective_from ?? "any"} → {row.effective_to ?? "any"}
        </p>
      ) : null}
      {row.notes ? (
        <p className="text-sm text-muted-foreground">{row.notes}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11"
          onClick={() => setEditing(true)}
        >
          Edit
        </Button>
        <form ref={formRef} action={formAction}>
          <input type="hidden" name="id" value={row.id} />
          {/* AlertDialogContent is portaled outside this form, so confirm
              submits via formRef.requestSubmit() rather than type="submit". */}
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                className="h-11"
              >
                {isPending ? "Removing…" : "Delete"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete this availability window?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the availability window from your schedule.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setConfirmOpen(false)}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setConfirmOpen(false)
                    formRef.current?.requestSubmit()
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </form>
      </div>
    </div>
  )
}
