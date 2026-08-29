import Link from "next/link"

import { cn } from "@/lib/utils"

import type { ReportPeriod } from "../_lib/get-report"
import { buildInsightsUrl } from "../_lib/url"

const PERIODS: Array<{ value: ReportPeriod; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
]

/** Plain links, no client JS — switching periods keeps the anchor date, so
 *  "today" stays "today" and a specific date stays itself across tabs. */
export function PeriodSelector({
  period,
  anchor,
  modules,
}: {
  period: ReportPeriod
  anchor: string
  modules: string[]
}) {
  return (
    <div
      role="tablist"
      aria-label="Report period"
      className="inline-flex gap-1 rounded-lg border border-border bg-muted/40 p-1"
    >
      {PERIODS.map((p) => {
        const active = p.value === period
        return (
          <Link
            key={p.value}
            role="tab"
            aria-selected={active}
            href={buildInsightsUrl({ period: p.value, anchor, modules })}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
          </Link>
        )
      })}
    </div>
  )
}
