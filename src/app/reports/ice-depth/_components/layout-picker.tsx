"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type LayoutOption = {
  slug: string
  name: string
  pointCount: number
}

export function LayoutPicker({ layouts }: { layouts: LayoutOption[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <Select
      disabled={pending}
      onValueChange={(slug) => {
        if (!slug) return
        startTransition(() => {
          router.push(`/reports/ice-depth/${encodeURIComponent(slug)}`)
        })
      }}
    >
      <SelectTrigger
        className="h-14 w-full text-base"
        aria-label="Select rink layout"
      >
        <SelectValue placeholder="Pick a rink layout…" />
      </SelectTrigger>
      <SelectContent>
        {layouts.map((l) => (
          <SelectItem key={l.slug} value={l.slug} className="text-base">
            <span className="font-semibold">{l.name}</span>
            <span className="text-muted-foreground ml-2 text-xs">
              {l.pointCount} point{l.pointCount === 1 ? "" : "s"}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
