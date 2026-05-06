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

type Props = {
  scope: "types" | "severities"
}

export function SeedDefaultsCard({ scope }: Props) {
  const [pending, startTransition] = useTransition()

  function onSeed() {
    startTransition(async () => {
      const r = await seedIncidentDefaults()
      if (!r.ok) {
        toast.error(r.error)
      } else {
        toast.success("Default types and severities seeded.")
      }
    })
  }

  const title =
    scope === "types"
      ? "No incident types yet"
      : "No severity levels yet"
  const description =
    scope === "types"
      ? "Seed the four standard types (Theft, Vandalism, Safety Concern, Other) or create your own below. Seeding also installs the four default severities if they don't already exist."
      : "Seed the four standard severities (Critical, High, Medium, Low) or create your own below. Seeding also installs the four default types if they don't already exist."

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={onSeed} disabled={pending}>
          {pending ? "Seeding…" : "Seed defaults"}
        </Button>
      </CardContent>
    </Card>
  )
}
