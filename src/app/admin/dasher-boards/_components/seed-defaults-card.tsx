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

import { seedDefaultDasherBoardsConfig } from "../actions"

/**
 * Shown when a facility has no door subtypes or issue categories yet — until
 * both exist, a walk can't classify anything it finds. Mirrors the seed cards
 * in the other configurable modules.
 */
export function SeedDefaultsCard() {
  const [pending, startTransition] = useTransition()

  function onSeed() {
    startTransition(async () => {
      const r = await seedDefaultDasherBoardsConfig()
      // ActionState's third arm is the idle { ok: null }, which this action
      // never returns — narrow explicitly rather than assuming.
      if (r.ok === false) toast.error(r.error)
      else if (r.ok) toast.success(r.message ?? "Defaults seeded.")
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>No door subtypes or issue categories yet</CardTitle>
        <CardDescription>
          Seed the four stock door subtypes (Bench, Scoreboard, Public Skate,
          Zamboni) and a starter set of issue categories for boards, glass, and
          doors. Only empty lists are filled, so this never overwrites your own
          entries. Rinks and the perimeter are not seeded — those are physical
          layout decisions.
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
