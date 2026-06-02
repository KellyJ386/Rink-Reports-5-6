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

import { seedIncidentDefaults } from "../actions"

export function SeedDefaultsCard() {
  const [pending, startTransition] = useTransition()

  function onSeed() {
    startTransition(async () => {
      const r = await seedIncidentDefaults()
      if (!r.ok) {
        toast.error(r.error)
      } else {
        toast.success("Default severities seeded.")
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>No severity levels yet</CardTitle>
        <CardDescription>
          Seed the four standard severities (Critical, High, Medium, Low) or
          create your own below.
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
