"use client"

// The inspection-walk companion bar. A walk no longer changes how logging
// works — the map stays fully interactive and tap-to-log is the same path —
// so the walk UI collapses to one persistent bar: walk state, any due
// checklist items (most days there are none — the daily cadence ships
// unseeded by design), and the sign-off that attests "everything I didn't
// tap is OK". Sticky at the bottom so it never blocks the diagram.

import { useState } from "react"
import { Footprints, ChevronDown, ChevronUp } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

import type { ChecklistItemRow } from "../../_lib/queries"

export function WalkBar({
  startedAt,
  synced,
  dueItems,
  responses,
  linkedItems,
  missingCount,
  pending,
  onAnswer,
  onComplete,
}: {
  /** Server started_at, or null for an offline-started walk awaiting sync. */
  startedAt: string | null
  /** False while the walk only exists in the offline queue. */
  synced: boolean
  dueItems: Array<ChecklistItemRow & { due: boolean }>
  responses: Record<string, "pass" | "flag">
  linkedItems: Set<string>
  missingCount: number
  pending: boolean
  onAnswer: (item: ChecklistItemRow, status: "pass" | "flag") => void
  onComplete: (notes: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const answered = dueItems.filter((i) => responses[i.id]).length

  return (
    <div className="sticky bottom-3 z-10">
      <div className="bg-card border-primary/40 flex flex-col gap-3 rounded-xl border p-3 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Footprints className="text-primary size-4 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-semibold">Walk in progress</p>
              <p className="text-muted-foreground truncate text-xs">
                {synced && startedAt
                  ? `Started ${new Date(startedAt).toLocaleTimeString()}`
                  : "Started offline — syncs when you reconnect"}
                {" · tap problem assets; untapped assets are attested OK at sign-off"}
              </p>
            </div>
          </div>
          <span className="flex items-center gap-2">
            {dueItems.length > 0 && (
              <Badge variant={answered < dueItems.length ? "warning" : "success"}>
                {answered}/{dueItems.length} due items
              </Badge>
            )}
            <Button
              size="sm"
              variant={expanded ? "outline" : "default"}
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              {expanded ? <ChevronDown aria-hidden /> : <ChevronUp aria-hidden />}
              Sign off
            </Button>
          </span>
        </div>

        {expanded && (
          <div className="flex flex-col gap-3">
            {dueItems.length > 0 ? (
              <DuePanel
                dueItems={dueItems}
                responses={responses}
                linkedItems={linkedItems}
                onAnswer={onAnswer}
              />
            ) : (
              <p className="text-muted-foreground text-xs">
                No checklist items due today.
              </p>
            )}
            <CompleteWalkForm
              pending={pending}
              missingCount={missingCount}
              onComplete={onComplete}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Due-today checklist panel (grouped by cadence)
// ---------------------------------------------------------------------------

export function DuePanel({
  dueItems,
  responses,
  linkedItems,
  onAnswer,
}: {
  dueItems: Array<ChecklistItemRow & { due: boolean }>
  responses: Record<string, "pass" | "flag">
  linkedItems: Set<string>
  onAnswer: (item: ChecklistItemRow, status: "pass" | "flag") => void
}) {
  const groups = (["daily", "weekly", "monthly", "yearly"] as const)
    .map((cadence) => ({
      cadence,
      items: dueItems.filter((i) => i.cadence === cadence),
    }))
    .filter((g) => g.items.length > 0)

  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Due today</span>
        <span className="text-muted-foreground text-xs">
          {dueItems.filter((i) => responses[i.id]).length}/{dueItems.length}{" "}
          answered
        </span>
      </div>
      {groups.map((group) => (
        <div key={group.cadence} className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
            {group.cadence}
          </span>
          {group.items.map((item) => {
            const answer = responses[item.id]
            return (
              <div
                key={item.id}
                className="bg-muted/30 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <span className="text-sm">{item.label}</span>
                <span className="flex items-center gap-1.5">
                  {answer === "flag" && !linkedItems.has(item.id) && (
                    <Badge variant="warning">needs issue</Badge>
                  )}
                  <Button
                    size="sm"
                    variant={answer === "pass" ? "default" : "outline"}
                    onClick={() => onAnswer(item, "pass")}
                  >
                    Pass
                  </Button>
                  <Button
                    size="sm"
                    variant={answer === "flag" ? "destructive" : "outline"}
                    onClick={() => onAnswer(item, "flag")}
                  >
                    Flag
                  </Button>
                </span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sign-off form (walk notes + complete button)
// ---------------------------------------------------------------------------

export function CompleteWalkForm({
  pending,
  missingCount,
  onComplete,
}: {
  pending: boolean
  missingCount: number
  onComplete: (notes: string) => void
}) {
  const [notes, setNotes] = useState("")
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        placeholder="Walk notes (optional)…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
      />
      <Button onClick={() => onComplete(notes)} disabled={pending}>
        {pending ? "Signing off…" : "Complete walk"}
      </Button>
      {missingCount > 0 && (
        <p className="text-muted-foreground text-xs">
          {missingCount} due checklist item(s) still need an answer before
          sign-off.
        </p>
      )}
    </div>
  )
}
