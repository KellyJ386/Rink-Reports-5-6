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

type RinkOption = { id: string; name: string; targetSlug: string | null }
type DiagramOption = { slug: string; name: string }

export function DiagramNav({
  rinks,
  currentRinkId,
  diagrams,
  currentSlug,
}: {
  rinks: RinkOption[]
  currentRinkId: string | null
  diagrams: DiagramOption[]
  currentSlug: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function go(slug: string) {
    startTransition(() => {
      router.push(`/reports/ice-depth/${encodeURIComponent(slug)}`)
    })
  }

  // Map a chosen rink to its default-or-first diagram slug.
  const targetForRink = new Map(rinks.map((r) => [r.id, r.targetSlug]))

  return (
    <div
      className="grid gap-2 px-3 pt-3"
      style={{
        gridTemplateColumns: rinks.length > 1 ? "1fr 1fr" : "1fr",
      }}
    >
      {rinks.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="ice-depth-rink-select"
            className="pl-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground"
          >
            Rink
          </label>
          <Select
            disabled={pending}
            value={currentRinkId ?? undefined}
            onValueChange={(rinkId) => {
              const slug = targetForRink.get(rinkId)
              if (slug) go(slug)
            }}
          >
            <SelectTrigger id="ice-depth-rink-select" className="h-11 w-full text-sm">
              <SelectValue placeholder="Pick a rink…" />
            </SelectTrigger>
            <SelectContent>
              {rinks.map((r) => (
                <SelectItem
                  key={r.id}
                  value={r.id}
                  disabled={!r.targetSlug}
                  className="text-sm"
                >
                  {r.name}
                  {!r.targetSlug && (
                    <span className="text-muted-foreground ml-2 text-xs">
                      no diagrams
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="ice-depth-diagram-select"
          className="pl-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground"
        >
          Diagram
        </label>
        <Select
          disabled={pending || diagrams.length === 0}
          value={currentSlug}
          onValueChange={(slug) => {
            if (slug && slug !== currentSlug) go(slug)
          }}
        >
          <SelectTrigger id="ice-depth-diagram-select" className="h-11 w-full text-sm">
            <SelectValue placeholder="Pick a diagram…" />
          </SelectTrigger>
          <SelectContent>
            {diagrams.map((d) => (
              <SelectItem key={d.slug} value={d.slug} className="text-sm">
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
