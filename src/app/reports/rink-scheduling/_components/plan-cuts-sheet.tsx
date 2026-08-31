"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import {
  applyResurfacePlan,
  previewResurfacePlan,
  type PlannedCutView,
} from "../resurface-plan-actions"
import { formatMinuteLabel } from "../_lib/grid-model"
import type { RinkRow } from "../_lib/types"

/**
 * "Plan today's cuts": preview the resurface bookings that fit the gaps
 * between rentals, then create them in one confirm. Apply RE-COMPUTES the
 * plan server-side — this preview is for the human's judgment, never the
 * placement authority — and any cut that races a concurrent booking loses to
 * the exclusion constraint and reports as skipped.
 */
export function PlanCutsSheet({
  rinks,
  defaultDayKey,
  onClose,
}: {
  rinks: RinkRow[]
  defaultDayKey: string
  onClose: () => void
}) {
  const [dayKey, setDayKey] = useState(defaultDayKey)
  const [rinkId, setRinkId] = useState("")
  const [cuts, setCuts] = useState<PlannedCutView[] | null>(null)
  const [hasCutType, setHasCutType] = useState(true)
  const [bufferNote, setBufferNote] = useState(false)
  const [pending, startTransition] = useTransition()

  function onPreview() {
    startTransition(async () => {
      const r = await previewResurfacePlan({ dayKey, rinkId: rinkId || null })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setCuts(r.cuts)
      setHasCutType(r.hasCutType)
      setBufferNote(r.bufferNote)
    })
  }

  function onApply() {
    startTransition(async () => {
      const r = await applyResurfacePlan({ dayKey, rinkId: rinkId || null })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(
        `${r.created} cut${r.created === 1 ? "" : "s"} scheduled` +
          (r.skipped > 0 ? `, ${r.skipped} skipped (the ice moved underneath)` : "") +
          ".",
      )
      onClose()
    })
  }

  return (
    <div
      className="bg-background/80 fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Plan cuts"
    >
      <div className="bg-card max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-xl border shadow-lg sm:rounded-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold">Plan cuts</h2>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <p className="text-muted-foreground text-sm">
            Proposes an ice resurface in every gap between that day&rsquo;s
            rentals that fits the configured cut time, so each flood is
            scheduled, tracked, and closable against its Ice Operations record.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="pc-day">Day</Label>
              <Input
                id="pc-day"
                type="date"
                value={dayKey}
                onChange={(e) => {
                  setDayKey(e.target.value)
                  setCuts(null)
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pc-rink">Rink</Label>
              <select
                id="pc-rink"
                value={rinkId}
                onChange={(e) => {
                  setRinkId(e.target.value)
                  setCuts(null)
                }}
                className="border-input bg-background h-10 rounded-md border px-2 text-sm"
              >
                <option value="">All rinks</option>
                {rinks.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Button onClick={onPreview} disabled={pending} variant={cuts ? "outline" : "default"}>
              {pending && cuts === null ? "Checking…" : "Preview"}
            </Button>
          </div>

          {cuts !== null && !hasCutType && (
            <p className="border-warning/40 bg-warning/10 rounded-md border p-3 text-sm">
              No active Ice Resurface booking type is set up, so nothing can be
              scheduled. Create one on the Lists tab of Rink Scheduling admin
              first.
            </p>
          )}

          {cuts !== null && bufferNote && cuts.length > 0 && (
            <p className="text-muted-foreground rounded-md border p-3 text-xs">
              This facility also reserves an ice-make buffer after each booking.
              Planned cuts start after that buffer, so scheduling them adds
              explicit, trackable cuts on top of the reserved time.
            </p>
          )}

          {cuts !== null && cuts.length === 0 && (
            <p className="text-muted-foreground rounded-md border p-3 text-sm">
              No gap on that day fits a cut — either the day is empty, fully
              back-to-back, or its cuts are already scheduled.
            </p>
          )}

          {cuts !== null && cuts.length > 0 && (
            <div className="flex flex-col gap-2">
              <ul className="flex flex-col divide-y rounded-md border">
                {cuts.map((c) => (
                  <li
                    key={`${c.rinkId}-${c.startsAtIso}`}
                    className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
                  >
                    <span className="shrink-0 font-mono text-xs tabular-nums">
                      {formatMinuteLabel(c.startMinute)} – {formatMinuteLabel(c.endMinute)}
                    </span>
                    <span className="text-muted-foreground min-w-0 flex-1 truncate">
                      {c.rinkName}
                    </span>
                  </li>
                ))}
              </ul>
              {hasCutType && (
                <div>
                  <Button onClick={onApply} disabled={pending}>
                    {pending ? "Scheduling…" : `Schedule ${cuts.length} cut${cuts.length === 1 ? "" : "s"}`}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
