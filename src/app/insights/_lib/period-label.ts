// Pure period-label formatting, shared by the on-screen date nav and the PDF
// export header — both must say the exact same thing for the exact same
// period, so this exists once. No server-only imports.

import type { ReportPeriod } from "./get-report"

/** Noon-UTC probe so a plain "YYYY-MM-DD" date key formats as itself,
 *  regardless of the renderer's own timezone (browser or PDF server). */
export function formatDateKey(key: string, options: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = key.split("-").map(Number)
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d, 12)),
  )
}

export function periodLabel(period: ReportPeriod, startDate: string, endDate: string): string {
  switch (period) {
    case "day":
      return formatDateKey(startDate, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    case "week":
      return `${formatDateKey(startDate, { month: "short", day: "numeric" })} – ${formatDateKey(endDate, { month: "short", day: "numeric", year: "numeric" })}`
    case "month":
      return formatDateKey(startDate, { month: "long", year: "numeric" })
    case "year":
      return `${formatDateKey(startDate, { month: "short", year: "numeric" })} – ${formatDateKey(endDate, { month: "short", year: "numeric" })}`
  }
}
