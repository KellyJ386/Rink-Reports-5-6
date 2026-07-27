"use client"

// The inspection-walk companion bar — the single sign-off surface. A walk no
// longer changes how logging works (the map stays fully interactive and
// tap-to-log is the same path) and the due checklist lives in its own card
// (due-card.tsx), so this bar is just: walk state, sign-off readiness, and
// the completion that attests "everything I didn't tap is OK". Sticky at the
// bottom so it never blocks the diagram.

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
  missingCount,
  pending,
  onComplete,
}: {
  /** Server started_at, or null for an offline-started walk awaiting sync. */
  startedAt: string | null
  /** False while the walk only exists in the offline queue. */
  synced: boolean
  dueItems: Array<ChecklistItemRow & { due: boolean }>
  responses: Record<string, "pass" | "flag">
  /** Due items unanswered or flagged without a linked issue (sign-off gate). */
  missingCount: number
  pending: boolean
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
          <CompleteWalkForm
            pending={pending}
            missingCount={missingCount}
            onComplete={onComplete}
          />
        )}
      </div>
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
          {missingCount} due checklist item(s) still need an answer (flags need
          a reported issue) before sign-off.
        </p>
      )}
    </div>
  )
}
