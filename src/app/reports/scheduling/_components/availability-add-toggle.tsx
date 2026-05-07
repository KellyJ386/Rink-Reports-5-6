"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { AvailabilityForm } from "./availability-form"

export function AvailabilityAddToggle() {
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
  return <AvailabilityForm onClose={() => setOpen(false)} />
}
