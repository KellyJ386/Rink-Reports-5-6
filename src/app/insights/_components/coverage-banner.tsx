import { AlertTriangle } from "lucide-react"

/**
 * "A monthly report covering 19 of 31 days must SAY so" — a coverage gap
 * means the nightly rollup never ran for some days in this period, not that
 * nothing happened. Silence here is how a compliance document becomes a
 * liability instead of a defense, so this renders whenever daysMissing > 0
 * and never tries to guess why the gap exists.
 */
export function CoverageBanner({
  daysInPeriod,
  daysWithData,
  daysMissing,
}: {
  daysInPeriod: number
  daysWithData: number
  daysMissing: number
}) {
  if (daysMissing <= 0) return null
  return (
    <div className="flex items-start gap-2 rounded-lg border border-warning bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>
        This report covers <strong>{daysWithData} of {daysInPeriod}</strong> day
        {daysInPeriod === 1 ? "" : "s"} in the period — {daysMissing} day
        {daysMissing === 1 ? "" : "s"} did not have a completed rollup and{" "}
        {daysMissing === 1 ? "is" : "are"} excluded from the totals below.
      </span>
    </div>
  )
}
