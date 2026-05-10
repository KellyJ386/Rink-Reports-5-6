"use client"

import Link from "next/link"
import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"

import {
  formatTimestamp,
  relativeAge,
  severityBadgeVariant,
  severityClasses,
  severityLabel,
  sourceModuleLabel,
} from "./format"

export type AlertListItem = {
  id: string
  source_module: string
  severity: string
  title: string
  body: string | null
  created_at: string
  requires_acknowledgement: boolean
  resolved_at: string | null
  acked: boolean
  excerpt: string
}

type Props = {
  alerts: AlertListItem[]
  timezone: string | null
}

const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "ice_operations", label: "Ice Ops" },
  { value: "refrigeration", label: "Refrigeration" },
  { value: "accident_reports", label: "Accident" },
  { value: "air_quality", label: "Air Quality" },
  { value: "incident_reports", label: "Incident" },
  { value: "scheduling", label: "Scheduling" },
]

const SEVERITY_OPTIONS = ["info", "warn", "high", "critical"] as const

export function AlertsList({ alerts, timezone }: Props) {
  const [search, setSearch] = useState("")
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [hideResolved, setHideResolved] = useState(false)
  const [sourcesSelected, setSourcesSelected] = useState<Set<string>>(new Set())
  const [severitiesSelected, setSeveritiesSelected] = useState<Set<string>>(
    new Set()
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return alerts.filter((a) => {
      if (unreadOnly && a.acked) return false
      if (hideResolved && a.resolved_at) return false
      if (sourcesSelected.size > 0 && !sourcesSelected.has(a.source_module))
        return false
      if (
        severitiesSelected.size > 0 &&
        !severitiesSelected.has(a.severity)
      )
        return false
      if (q.length > 0) {
        const hay =
          `${a.title} ${a.body ?? ""}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [alerts, search, unreadOnly, hideResolved, sourcesSelected, severitiesSelected])

  function toggleSource(value: string) {
    setSourcesSelected((prev) => {
      const next = new Set(prev)
      if (next.has(value)) {
        next.delete(value)
      } else {
        next.add(value)
      }
      return next
    })
  }

  function toggleSeverity(value: string) {
    setSeveritiesSelected((prev) => {
      const next = new Set(prev)
      if (next.has(value)) {
        next.delete(value)
      } else {
        next.add(value)
      }
      return next
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3">
        <input
          type="search"
          placeholder="Search title or body…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border-input bg-background focus-visible:ring-ring/50 focus-visible:border-ring h-11 w-full rounded-md border px-3 text-base shadow-xs outline-none focus-visible:ring-[3px]"
          aria-label="Search alerts"
        />

        <div className="flex flex-wrap gap-1.5">
          <span className="self-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Source
          </span>
          {SOURCE_OPTIONS.map((opt) => {
            const active = sourcesSelected.has(opt.value)
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleSource(opt.value)}
                aria-pressed={active}
                className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {opt.label}
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <span className="self-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Severity
          </span>
          {SEVERITY_OPTIONS.map((value) => {
            const active = severitiesSelected.has(value)
            return (
              <button
                key={value}
                type="button"
                onClick={() => toggleSeverity(value)}
                aria-pressed={active}
                className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-medium transition-colors ${
                  active
                    ? severityClasses(value)
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {severityLabel(value)}
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Unread only
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hideResolved}
              onChange={(e) => setHideResolved(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Hide resolved
          </label>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          No alerts match your filters.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((a) => (
            <li key={a.id}>
              <Link
                href={`/reports/communications?alert=${a.id}`}
                className={`flex flex-col gap-2 rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 ${
                  !a.acked ? "border-primary/40" : ""
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    {sourceModuleLabel(a.source_module)}
                  </Badge>
                  <Badge variant={severityBadgeVariant(a.severity)}>
                    {severityLabel(a.severity)}
                  </Badge>
                  {a.requires_acknowledgement && !a.acked ? (
                    <Badge variant="outline">Ack required</Badge>
                  ) : null}
                  {a.resolved_at ? (
                    <Badge variant="success">Resolved</Badge>
                  ) : null}
                  {!a.acked ? (
                    <span className="ml-auto inline-flex h-2 w-2 rounded-full bg-primary" />
                  ) : null}
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span
                    className={`text-base ${
                      !a.acked ? "font-semibold" : "font-medium"
                    }`}
                  >
                    {a.title}
                  </span>
                  <span
                    className="text-xs text-muted-foreground"
                    title={formatTimestamp(a.created_at, timezone)}
                  >
                    {relativeAge(a.created_at)}
                  </span>
                </div>
                {a.excerpt ? (
                  <p className="text-sm text-muted-foreground">{a.excerpt}</p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
