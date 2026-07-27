"use client"

// Standalone due-items view, independent of the perimeter walk. The checklist
// is no longer coupled to walk mode: this card renders whenever items are due
// (most days there are none — the daily cadence ships unseeded by design),
// and answering an item silently resumes/creates today's inspection record as
// the response container (the schema stores responses per inspection).
// Recording is finalized by the walk sign-off — the single completion
// surface, in walk-bar.tsx.

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import type { ChecklistItemRow } from "../../_lib/queries"

export function DueCard({
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
  const outstanding = dueItems.filter(
    (i) =>
      !responses[i.id] ||
      (responses[i.id] === "flag" && !linkedItems.has(i.id)),
  ).length

  return (
    <Card className="gap-3 py-4">
      <CardHeader>
        <CardTitle>Checklist — due today</CardTitle>
        <CardDescription>
          {outstanding > 0
            ? "Answers save to today's inspection record and are finalized when it's signed off."
            : "All answered — sign off below to record them."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DuePanel
          dueItems={dueItems}
          responses={responses}
          linkedItems={linkedItems}
          onAnswer={onAnswer}
        />
      </CardContent>
    </Card>
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
