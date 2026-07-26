"use client"

// Walk sub-panels shared by the free-tap condition map and the guided
// stepped walk: the due-today checklist (grouped by cadence) and the
// sign-off form. Split out of condition-map.tsx so guided-walk.tsx can
// reuse them without a circular import.

import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

import type { ChecklistItemRow } from "../../_lib/queries"

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
