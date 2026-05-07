"use client"

import { useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { seedSchedulingDefaults } from "../../_lib/governance-actions"

export function SeedDefaultsButton() {
  const [pending, startTransition] = useTransition()
  return (
    <Button
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const r = await seedSchedulingDefaults()
          if (r.ok === true) toast.success(r.message ?? "Seeded.")
          else if (r.ok === false) toast.error(r.error)
        })
      }}
    >
      {pending ? "Seeding…" : "Seed defaults"}
    </Button>
  )
}
