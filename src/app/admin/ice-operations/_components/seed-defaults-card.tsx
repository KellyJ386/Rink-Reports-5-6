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

import { seedDefaultIceOperationsConfig } from "../actions"

export function SeedDefaultsCard() {
  const [pending, startTransition] = useTransition()

  function onSeed() {
    startTransition(async () => {
      const r = await seedDefaultIceOperationsConfig()
      if (!r.ok) {
        toast.error(r.error)
      } else {
        toast.success("Default ice operations config seeded.")
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>No rinks or circle-check items yet</CardTitle>
        <CardDescription>
          Seed a default settings row plus 5 starter circle-check items
          (4 ice resurfacer, 1 edger). You can edit or add more after seeding.
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
