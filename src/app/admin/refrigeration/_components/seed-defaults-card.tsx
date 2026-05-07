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

import { seedDefaultRefrigerationSections } from "../actions"

export function SeedDefaultsCard() {
  const [pending, startTransition] = useTransition()

  function onSeed() {
    startTransition(async () => {
      const r = await seedDefaultRefrigerationSections()
      if (!r.ok) {
        toast.error(r.error)
      } else {
        toast.success("Default refrigeration sections seeded.")
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>No sections yet</CardTitle>
        <CardDescription>
          Seed the six standard sections (Compressors, Pumps, Condensers, Supply
          / Return, Machine Hours, Alarms) and a default settings row, or create
          your own below.
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
