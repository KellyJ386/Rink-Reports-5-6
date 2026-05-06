"use client"

import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"

import { seedRolesForCurrentFacility } from "../actions"

type Props = {
  facilityId: string
}

export function SeedRolesButton({ facilityId }: Props) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null)
          startTransition(async () => {
            const result = await seedRolesForCurrentFacility(facilityId)
            if (result && "ok" in result && result.ok === false) {
              setError(result.error)
            }
          })
        }}
      >
        {pending ? "Seeding..." : "Seed default roles"}
      </Button>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  )
}
