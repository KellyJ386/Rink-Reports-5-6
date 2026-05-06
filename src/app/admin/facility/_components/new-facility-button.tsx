"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"

import { FacilityForm } from "./facility-form"

export function NewFacilityButton() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <>
      <Button onClick={() => setOpen(true)}>New Facility</Button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-facility-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            aria-hidden="true"
            className="bg-background/80 absolute inset-0 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="bg-card text-card-foreground relative z-10 w-full max-w-md rounded-xl border p-6 shadow-lg">
            <div className="mb-4 flex flex-col gap-1">
              <h2
                id="new-facility-title"
                className="text-lg font-semibold leading-none tracking-tight"
              >
                New facility
              </h2>
              <p className="text-muted-foreground text-sm">
                Create a facility and seed its default roles.
              </p>
            </div>
            <FacilityForm mode="create" onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  )
}
