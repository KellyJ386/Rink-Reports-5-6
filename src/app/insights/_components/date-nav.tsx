import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"

import type { ReportPeriod } from "../_lib/get-report"
import { periodLabel } from "../_lib/period-label"
import { shiftAnchor } from "../_lib/shift-anchor"
import { buildInsightsUrl } from "../_lib/url"

export function DateNav({
  period,
  anchor,
  startDate,
  endDate,
  todayAnchor,
  modules,
}: {
  period: ReportPeriod
  anchor: string
  startDate: string
  endDate: string
  /** Today's date key in the facility's own timezone, for the "Today" reset link. */
  todayAnchor: string
  modules: string[]
}) {
  const prevHref = buildInsightsUrl({ period, anchor: shiftAnchor(anchor, period, -1), modules })
  const nextHref = buildInsightsUrl({ period, anchor: shiftAnchor(anchor, period, 1), modules })
  const todayHref = buildInsightsUrl({ period, anchor: todayAnchor, modules })

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline" size="icon" aria-label={`Previous ${period}`}>
        <Link href={prevHref}>
          <ChevronLeft className="size-4" />
        </Link>
      </Button>
      <Button asChild variant="outline" size="icon" aria-label={`Next ${period}`}>
        <Link href={nextHref}>
          <ChevronRight className="size-4" />
        </Link>
      </Button>
      <span className="min-w-0 truncate text-base font-semibold tracking-tight">
        {periodLabel(period, startDate, endDate)}
      </span>
      {anchor !== todayAnchor && (
        <Button asChild variant="ghost" size="sm">
          <Link href={todayHref}>Today</Link>
        </Button>
      )}
    </div>
  )
}
