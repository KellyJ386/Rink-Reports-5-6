"use client"

import { useActionState, useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { Badge, type BadgeProps } from "@/components/ui/badge"
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
        <Badge variant={typeBadgeVariant(row.availability_type)} className="capitalize">
          {row.availability_type}
        </Badge>
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
