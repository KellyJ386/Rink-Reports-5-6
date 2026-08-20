"use client"

import { useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { seedRinkSchedulingDefaults } from "../actions"

export function SeedDefaultsCard() {
  const [pending, startTransition] = useTransition()

  function onSeed() {
    startTransition(async () => {
      const r = await seedRinkSchedulingDefaults()
      if (!r.ok) toast.error(r.error)
      else toast.success("Default rink scheduling config seeded.")
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start with the defaults</CardTitle>
        <CardDescription>
          Adds the standard booking types, customer types and payment methods, a
          Monday–Sunday hours grid and a zero-rate default rate card. Existing
          entries are left alone, so it is safe to run more than once. Rinks and
          locker rooms are not seeded — those are yours to name below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={onSeed} disabled={pending}>
          {pending ? "Seeding…" : "Seed defaults"}
        </Button>
      </CardContent>
    </Card>
  )
}
