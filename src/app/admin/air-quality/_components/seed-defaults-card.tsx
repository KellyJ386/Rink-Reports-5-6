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

import { seedDefaultAirQualityConfig } from "../actions"

export function SeedDefaultsCard() {
  const [pending, startTransition] = useTransition()

  function onSeed() {
    startTransition(async () => {
      const r = await seedDefaultAirQualityConfig()
      if (!r.ok) {
        toast.error(r.error)
      } else {
        toast.success("Default air quality config seeded.")
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Get started</CardTitle>
        <CardDescription>
          Seed the standard ice-rink reading types — CO, NO2, and CO2 — with
          MN/NY-style thresholds (CO acceptable 20 ppm / evacuate above 83 ppm;
          NO2 acceptable 0.3 ppm / evacuate above 2.0 ppm), a default settings
          row (alerts on, jurisdiction <code>MN</code>), and the matching
          MN compliance / required-action rules. Add your own locations,
          equipment, and custom reading types after.
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
