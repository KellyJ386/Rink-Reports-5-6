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

import { seedDefaultIceDepthSettings } from "../actions"

export function SeedDefaultsCard() {
  const [pending, startTransition] = useTransition()

  function onSeed() {
    startTransition(async () => {
      const r = await seedDefaultIceDepthSettings()
      if (!r.ok) {
        toast.error(r.error)
      } else {
        toast.success("Default ice depth settings seeded.")
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>No ice depth settings yet</CardTitle>
        <CardDescription>
          Seed a default settings row (inches, low/high thresholds, default
          colors and alerting). Layouts and points are built by hand on the
          Layouts tab.
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
