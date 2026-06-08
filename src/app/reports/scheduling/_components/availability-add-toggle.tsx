"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import type { JobAreaOption } from "../types"
import { AvailabilityForm } from "./availability-form"

export function AvailabilityAddToggle({
  jobAreas = [],
  fixedDay,
}: {
  jobAreas?: JobAreaOption[]
  fixedDay?: number
}) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <Button
        type="button"
        size="lg"
        onClick={() => setOpen(true)}
        className="h-12 w-full text-base sm:w-auto"
      >
        Add availability
      </Button>
    )
  }
  return (
    <AvailabilityForm
      onClose={() => setOpen(false)}
      jobAreas={jobAreas}
      fixedDay={fixedDay}
    />
  )
}
