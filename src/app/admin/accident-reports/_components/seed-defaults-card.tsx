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

import { seedAccidentDefaults } from "../actions"

export function SeedDefaultsCard() {
  const [pending, startTransition] = useTransition()

  function onSeed() {
    startTransition(async () => {
      const r = await seedAccidentDefaults()
      if (!r.ok) {
        toast.error(r.error)
      } else {
        toast.success("Default accident dropdowns seeded.")
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>No accident dropdowns yet</CardTitle>
        <CardDescription>
          Seed the canonical set across all six categories (injury type, body
          part, location, activity, medical attention, severity). Idempotent:
          safe to run more than once. You can edit, deactivate, or delete
          individual values afterwards.
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
