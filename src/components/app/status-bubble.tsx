import { Check, TriangleAlert } from "lucide-react"

import type { ModuleStatus } from "@/app/dashboard/_lib/status"
import { cn } from "@/lib/utils"

// =============================================================================
// StatusBubble — the dashboard module "monitoring light".
//
//   red    → latest report/reading is out of spec, OR (count modules) N items
//            need attention. On-brand accessible red (--rr-red #F42A2A) on navy.
//   green  → latest report/reading within spec (brand lime --rr-green #4DFF00).
//   none   → status null/undefined ⇒ renders nothing (no data yet).
//
// Not color-only: every bubble carries a shape/glyph (count number or alert
// triangle for red, check for green) AND an aria-label + native tooltip, so it
// is distinguishable by screen readers and colorblind users.
// =============================================================================

function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

export function StatusBubble({
  status,
  moduleTitle,
}: {
  status: ModuleStatus | null | undefined
  moduleTitle: string
}) {
  if (!status) return null

  const isRed = status.state === "red"
  const hasCount = typeof status.count === "number"

  const label = isRed
    ? hasCount
      ? `${moduleTitle}: ${pluralize(status.count as number, "report")} need attention`
      : `${moduleTitle}: latest report out of spec`
    : `${moduleTitle}: latest report within spec`

  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={cn(
        "pointer-events-auto inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums shadow-[var(--shadow-elev-1)] ring-2 ring-white/80",
        isRed ? "bg-rr-red text-white" : "bg-rr-green text-rr-navy-dark",
      )}
    >
      {isRed ? (
        hasCount ? (
          <span aria-hidden="true">{status.count}</span>
        ) : (
          <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.5} />
        )
      ) : (
        <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={3} />
      )}
    </span>
  )
}
