"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { weekdayOfKey } from "@/lib/timezone"

import { findOpenSlots, type OpenSlot } from "../find-slot-actions"
import { formatMinuteLabel } from "../_lib/grid-model"
import type { RinkRow } from "../_lib/types"

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const DURATION_CHOICES = [30, 45, 60, 75, 90, 120, 150, 180] as const

/**
 * The front-desk phone-call answer: duration + date range in, open windows
 * out. Read-only — picking a result opens the ordinary booking sheet
 * pre-filled, whose createBooking re-checks everything; a result gone stale
 * in the meantime loses to the exclusion constraint like any other conflict.
 */
export function FindSlotSheet({
  rinks,
  defaultDayKey,
  onPick,
  onClose,
}: {
  rinks: RinkRow[]
  defaultDayKey: string
  /** Opens the booking sheet in create mode at the chosen slot. */
  onPick: (rinkId: string, dayKey: string, startMinute: number) => void
  onClose: () => void
}) {
  const [duration, setDuration] = useState(60)
  const [fromDayKey, setFromDayKey] = useState(defaultDayKey)
  const [days, setDays] = useState(7)
  const [rinkId, setRinkId] = useState("")
  const [slots, setSlots] = useState<OpenSlot[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [pending, startTransition] = useTransition()

  function onSearch() {
    startTransition(async () => {
      const r = await findOpenSlots({
        durationMinutes: duration,
        fromDayKey,
        days,
        rinkId: rinkId || null,
      })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setSlots(r.slots)
      setTruncated(r.truncated)
    })
  }

  return (
    <div
      className="bg-background/80 fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Find a slot"
    >
      <div className="bg-card max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-xl border shadow-lg sm:rounded-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold">Find a slot</h2>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="fs-duration">Ice time</Label>
              <select
                id="fs-duration"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="border-input bg-background h-10 rounded-md border px-2 text-sm"
              >
                {DURATION_CHOICES.map((m) => (
                  <option key={m} value={m}>
                    {m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="fs-rink">Rink</Label>
              <select
                id="fs-rink"
                value={rinkId}
                onChange={(e) => setRinkId(e.target.value)}
                className="border-input bg-background h-10 rounded-md border px-2 text-sm"
              >
                <option value="">Any rink</option>
                {rinks.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="fs-from">Starting</Label>
              <Input
                id="fs-from"
                type="date"
                value={fromDayKey}
                onChange={(e) => setFromDayKey(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="fs-days">Days to search</Label>
              <select
                id="fs-days"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="border-input bg-background h-10 rounded-md border px-2 text-sm"
              >
                {[1, 3, 7, 14].map((d) => (
                  <option key={d} value={d}>
                    {d === 1 ? "Just that day" : `${d} days`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Button onClick={onSearch} disabled={pending}>
              {pending ? "Searching…" : "Search"}
            </Button>
          </div>

          {slots !== null && slots.length === 0 && (
            <p className="text-muted-foreground rounded-md border p-3 text-sm">
              Nothing open for that duration in the searched window. Try a
              shorter slot, more days, or another rink.
            </p>
          )}

          {slots !== null && slots.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-muted-foreground text-xs">
                {slots.length} open {slots.length === 1 ? "window" : "windows"}
                {truncated ? " (more exist — narrow the search to see them)" : ""}.
                Open hours only; a slot is offered with this rink&rsquo;s
                ice-make time already accounted for.
              </p>
              <ul className="flex flex-col divide-y rounded-md border">
                {slots.map((s) => (
                  <li key={`${s.rinkId}-${s.dayKey}-${s.startMinute}`}>
                    <button
                      type="button"
                      onClick={() => onPick(s.rinkId, s.dayKey, s.startMinute)}
                      className="hover:bg-muted/40 focus-visible:ring-ring flex w-full flex-wrap items-center gap-3 px-3 py-2 text-left text-sm focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <span className="w-24 shrink-0 font-mono text-xs tabular-nums">
                        {DAY_NAMES[weekdayOfKey(s.dayKey)]} {s.dayKey.slice(5)}
                      </span>
                      <span className="shrink-0 font-mono text-xs tabular-nums">
                        {formatMinuteLabel(s.startMinute)} – {formatMinuteLabel(s.endMinute)}
                      </span>
                      <span className="text-muted-foreground min-w-0 flex-1 truncate">
                        {s.rinkName}
                      </span>
                      <span className="text-primary text-xs font-medium">Book →</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
