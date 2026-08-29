// Pure URL-building for /insights — every control (period tabs, date nav,
// module picker) is a plain <Link>/<form method="get"> against this same
// query-param shape, so the whole page works with zero client JS.

import type { ReportPeriod } from "./get-report"

export type InsightsParams = {
  period: ReportPeriod
  anchor: string
  modules: string[]
}

export function buildInsightsUrl(params: InsightsParams): string {
  const search = new URLSearchParams()
  search.set("period", params.period)
  search.set("anchor", params.anchor)
  if (params.modules.length > 0) search.set("modules", params.modules.join(","))
  return `/insights?${search.toString()}`
}
