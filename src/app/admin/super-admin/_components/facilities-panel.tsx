"use client"

import { useActionState } from "react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"

import { setFacilityActive } from "../actions"
import type { ActionState, FacilityWithStats } from "../types"

const INITIAL: ActionState = { ok: null }

interface Props {
  facilities: FacilityWithStats[]
}

export function FacilitiesPanel({ facilities }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Facilities</CardTitle>
        <CardDescription>
          All tenant facilities. Only super admins can activate or deactivate
          facilities.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {facilities.length === 0 && (
          <p className="text-sm text-muted-foreground">No facilities found.</p>
        )}
        {facilities.map((f) => (
          <FacilityRow key={f.id} facility={f} />
        ))}
      </CardContent>
    </Card>
  )
}

function FacilityRow({ facility }: { facility: FacilityWithStats }) {
  const [state, formAction, pending] = useActionState(setFacilityActive, INITIAL)

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border px-4 py-3">
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{facility.name}</span>
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${
              facility.is_active
                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
            }`}
          >
            {facility.is_active ? "Active" : "Inactive"}
          </span>
        </div>
        <span className="text-xs text-muted-foreground font-mono">{facility.slug}</span>
        <span className="text-xs text-muted-foreground">
          {facility.employee_count} employee{facility.employee_count !== 1 ? "s" : ""} ·{" "}
          {facility.timezone} · Created{" "}
          {new Date(facility.created_at).toLocaleDateString()}
        </span>
        {state.ok === false && (
          <p className="text-xs text-destructive">{state.error}</p>
        )}
        {state.ok === true && (
          <p className="text-xs text-green-600 dark:text-green-400">{state.message}</p>
        )}
      </div>

      <form action={formAction} className="shrink-0">
        <input type="hidden" name="facility_id" value={facility.id} />
        <input
          type="hidden"
          name="value"
          value={facility.is_active ? "false" : "true"}
        />
        <Button
          type="submit"
          variant={facility.is_active ? "outline" : "default"}
          size="sm"
          disabled={pending}
        >
          {facility.is_active ? "Deactivate" : "Activate"}
        </Button>
      </form>
    </div>
  )
}
