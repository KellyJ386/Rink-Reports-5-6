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
      style={{
        padding: "12px 12px 0",
        display: "grid",
        gridTemplateColumns: rinks.length > 1 ? "1fr 1fr" : "1fr",
        gap: 8,
      }}
    >
      {rinks.length > 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: "var(--muted-foreground)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              paddingLeft: 4,
            }}
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
            <SelectTrigger className="h-11 w-full text-sm" aria-label="Select rink">
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

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "var(--muted-foreground)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            paddingLeft: 4,
          }}
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
          <SelectTrigger className="h-11 w-full text-sm" aria-label="Select diagram">
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
