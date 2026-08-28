"use client"

// The inspection-walk companion bar — the single surface for the whole walk
// lifecycle: start (routine, one tap, or an annual contractor inspection
// with a contractor name/company), the in-progress state (kind indicator +
// guided walkthrough launcher), and sign-off. The map stays fully
// interactive throughout (tap-to-log is the same path whether or not a walk
// is open) and the due checklist lives in its own card (due-card.tsx), so
// this bar's whole job is: how did the walk start, how is it going, and is
// it ready to sign off. Sticky at the bottom only once a walk is open, so it
// never blocks the diagram before then.

import { useState } from "react"
import { ChevronDown, ChevronUp, Footprints, ListChecks } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { LocalDateTime } from "@/components/app/local-datetime"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import type { ChecklistItemRow } from "../../_lib/queries"

export function WalkBar({
  active,
  canStart,
  startedAt,
  synced,
  walkKind,
  contractorName,
  contractorCompany,
  dueItems,
  responses,
  missingCount,
  pending,
  expanded,
  onExpandedChange,
  onStartRoutine,
  onStartAnnual,
  onComplete,
  onLaunchGuidedWalk,
}: {
  /** Whether a walk (server-confirmed or offline-queued) is currently open. */
  active: boolean
  /** Whether the caller may start/continue a walk (submit tier). */
  canStart: boolean
  /** Server started_at, or null for an offline-started walk awaiting sync. */
  startedAt: string | null
  /** False while the walk only exists in the offline queue. */
  synced: boolean
  /** The open walk's kind; null when no walk is active. */
  walkKind: "routine" | "annual_contractor" | null
  contractorName: string | null
  contractorCompany: string | null
  dueItems: Array<ChecklistItemRow & { due: boolean }>
  responses: Record<string, "pass" | "flag">
  /** Due items unanswered or flagged without a linked issue (sign-off gate). */
  missingCount: number
  pending: boolean
  /** Sign-off panel expansion, lifted so the guided walkthrough can open it. */
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  onStartRoutine: () => void
  onStartAnnual: (input: {
    contractorName: string
    contractorCompany: string | null
  }) => void
  onComplete: (notes: string) => void
  onLaunchGuidedWalk: () => void
}) {
  const [annualOpen, setAnnualOpen] = useState(false)
  const answered = dueItems.filter((i) => responses[i.id]).length

  if (!active) {
    if (!canStart) return null
    return (
      <div className="bg-card flex flex-col gap-3 rounded-xl border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onStartRoutine} disabled={pending}>
            <Footprints aria-hidden />
            Start inspection walk
          </Button>
          {!annualOpen && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAnnualOpen(true)}
              disabled={pending}
            >
              Annual contractor inspection…
            </Button>
          )}
        </div>
        {annualOpen && (
          <AnnualStartForm
            pending={pending}
            onStart={(input) => {
              onStartAnnual(input)
              setAnnualOpen(false)
            }}
            onCancel={() => setAnnualOpen(false)}
          />
        )}
      </div>
    )
  }

  const isAnnual = walkKind === "annual_contractor"

  return (
    <div className="sticky bottom-3 z-10">
      <div className="bg-card border-primary/40 flex flex-col gap-3 rounded-xl border p-3 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Footprints className="text-primary size-4 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                {isAnnual ? (
                  <>
                    Annual contractor inspection —{" "}
                    {contractorName ?? "Unknown contractor"}
                  </>
                ) : (
                  "Walk in progress"
                )}
                {isAnnual && <Badge variant="special">Annual contractor</Badge>}
              </p>
              <p className="text-muted-foreground truncate text-xs">
                {synced && startedAt ? (
                  <>
                    Started <LocalDateTime iso={startedAt} format="time" />
                  </>
                ) : (
                  "Started offline — syncs when you reconnect"
                )}
                {isAnnual && contractorCompany ? ` · ${contractorCompany}` : ""}
                {" · tap problem assets; untapped assets are attested OK at sign-off"}
              </p>
            </div>
          </div>
          <span className="flex flex-wrap items-center gap-2">
            {dueItems.length > 0 && (
              <Badge variant={answered < dueItems.length ? "warning" : "success"}>
                {answered}/{dueItems.length} due items
              </Badge>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={onLaunchGuidedWalk}
              disabled={pending}
            >
              <ListChecks aria-hidden />
              Guided walkthrough
            </Button>
            <Button
              size="sm"
              variant={expanded ? "outline" : "default"}
              onClick={() => onExpandedChange(!expanded)}
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
// Annual contractor start form — contractor name (required) + company
// (optional). Kept collapsed behind a secondary trigger so the routine path
// (the default) stays a single tap, unchanged.
// ---------------------------------------------------------------------------

function AnnualStartForm({
  pending,
  onStart,
  onCancel,
}: {
  pending: boolean
  onStart: (input: {
    contractorName: string
    contractorCompany: string | null
  }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState("")
  const [company, setCompany] = useState("")
  const trimmedName = name.trim()

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <p className="text-sm font-semibold">Annual contractor inspection</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="annual-contractor-name">Contractor name</Label>
          <Input
            id="annual-contractor-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Contractor name"
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="annual-contractor-company">Company (optional)</Label>
          <Input
            id="annual-contractor-company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending || trimmedName.length === 0}
          onClick={() =>
            onStart({
              contractorName: trimmedName,
              contractorCompany: company.trim() ? company.trim() : null,
            })
          }
        >
          Start annual inspection
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
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
