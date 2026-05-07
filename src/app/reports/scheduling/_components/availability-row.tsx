"use client"

import { useActionState, useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { deleteAvailability } from "../actions"
import { INITIAL_ACTION_STATE } from "../types"
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
}

function DeleteSubmit() {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      variant="outline"
      size="sm"
      disabled={pending}
      className="h-11"
    >
      {pending ? "Removing…" : "Delete"}
    </Button>
  )
}

function typeBadge(type: string): string {
  switch (type) {
    case "preferred":
      return "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
    case "unavailable":
      return "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200"
    default:
      return "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-200"
  }
}

export function AvailabilityRow({ row }: { row: Row }) {
  const [editing, setEditing] = useState(false)
  const [state, formAction] = useActionState(
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
    return <AvailabilityForm initial={row} onClose={() => setEditing(false)} />
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {formatTimeOnly(row.start_time)} – {formatTimeOnly(row.end_time)}
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${typeBadge(
            row.availability_type
          )}`}
        >
          {row.availability_type}
        </span>
      </div>
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
        <form action={formAction}>
          <input type="hidden" name="id" value={row.id} />
          <DeleteSubmit />
        </form>
      </div>
    </div>
  )
}
