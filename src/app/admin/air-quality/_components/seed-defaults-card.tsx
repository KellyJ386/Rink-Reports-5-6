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
          Seed the standard CO and CO2 reading types with their default
          alert/compliance thresholds (CO alert 25 ppm / compliance 50 ppm; CO2
          alert 1000 ppm / compliance 5000 ppm) plus a default settings row
          (alerts on, default jurisdiction <code>us_federal</code>). Add your
          own locations, equipment, and custom reading types after.
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
