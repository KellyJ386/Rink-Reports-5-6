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

import { seedDomainDefaults } from "../actions"
import type { DomainConfig } from "../types"

export function SeedDefaultsCard({ config }: { config: DomainConfig }) {
  const [pending, startTransition] = useTransition()

  function onSeed() {
    startTransition(async () => {
      const r = await seedDomainDefaults(config.domain)
      if (!r.ok) {
        toast.error(r.error)
      } else {
        toast.success(`Default ${config.label.toLowerCase()} seeded.`)
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>No {config.label.toLowerCase()} yet</CardTitle>
        <CardDescription>
          Seed the canonical set. Idempotent: safe to run more than once, and it
          never overwrites edits you&apos;ve already made. You can add, edit,
          deactivate, or delete individual options afterwards.
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
