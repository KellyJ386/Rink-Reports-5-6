// Read-only, presentational rendering of one rink's booking list for a
// single day. No "use client" needed — nothing here is interactive: no
// onClick, no draggable, no context menu, on any chip, for any caller. That
// is deliberate, not an oversight — this is the shared layer a read-only
// surface (the dashboard widget) renders directly, and an eventual editable
// surface would WRAP this and add its own interactive layer on top rather
// than this component growing one.
//
// Imports nothing from ../actions, ../series-actions, ../locker-actions, or
// ../resurface-actions (the module's server actions) — only the pure
// geometry/formatting helpers from ../_lib/grid-model, which are themselves
// dependency-free. A bundle that includes this file pulls in zero scheduling
// mutation code.

import { Badge } from "@/components/ui/badge"

import { formatMinuteLabel, type DayWindow } from "../_lib/grid-model"

export type ReadOnlyBookingChip = {
  id: string
  startMinute: number
  endMinute: number
  label: string
  typeColor: string
  tentative: boolean
  isResurface: boolean
  resurfaceStatus: "scheduled" | "completed" | "skipped" | null
}

function resurfaceChipLabel(status: ReadOnlyBookingChip["resurfaceStatus"]): string {
  if (status === "completed") return "cut ✓"
  if (status === "skipped") return "skipped"
  return "cut"
}

export function RinkScheduleReadOnly({
  window,
  bookings,
}: {
  window: DayWindow
  bookings: ReadOnlyBookingChip[]
}) {
  if (window.isClosed && bookings.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        {window.exceptionLabel ? `Closed — ${window.exceptionLabel}.` : "Facility closed today."}
      </p>
    )
  }

  if (bookings.length === 0) {
    return <p className="text-muted-foreground text-xs">Nothing booked today.</p>
  }

  return (
    <ul className="flex flex-wrap gap-1.5">
      {bookings.map((b) => (
        <li
          key={b.id}
          className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
            b.tentative ? "border-dashed opacity-80" : ""
          }`}
          style={{
            borderColor: b.typeColor,
            backgroundColor: `color-mix(in oklab, ${b.typeColor} ${b.isResurface ? 28 : 14}%, var(--color-card))`,
            backgroundImage: b.isResurface
              ? "repeating-linear-gradient(45deg, color-mix(in oklab, currentColor 14%, transparent) 0 4px, transparent 4px 8px)"
              : undefined,
          }}
          title={`${formatMinuteLabel(b.startMinute)}–${formatMinuteLabel(b.endMinute)} · ${b.label}${
            b.tentative ? " (tentative)" : ""
          }`}
        >
          <span className="font-mono tabular-nums">{formatMinuteLabel(b.startMinute)}</span>
          <span className="max-w-28 truncate">{b.label}</span>
          {b.isResurface && (
            <Badge variant="outline" className="h-4 px-1 text-[9px] leading-none uppercase">
              {resurfaceChipLabel(b.resurfaceStatus)}
            </Badge>
          )}
        </li>
      ))}
    </ul>
  )
}
