"use client"

import { usePathname } from "next/navigation"
import { Clock, Thermometer, User } from "lucide-react"
import { usePathname } from "next/navigation"
import { useSyncExternalStore } from "react"

// Routes that render their own full-width header card and therefore suppress
// this slim shared bar.
const SUPPRESSED_ROUTES = new Set(["/reports/refrigeration"])

type Props = {
  userName: string
  tempF: number | null
  tempLocation: string | null
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  })
}

function subscribeClock(cb: () => void) {
  const id = setInterval(cb, 1000)
  return () => clearInterval(id)
}

export function ReportPageHeader({ userName, tempF, tempLocation }: Props) {
  const pathname = usePathname()
  const nowMs = useSyncExternalStore(
    subscribeClock,
    () => Date.now(),
    () => null,
  )
  const now = nowMs == null ? null : new Date(nowMs)

  if (SUPPRESSED_ROUTES.has(pathname)) return null
  // Ice Operations renders its own richer context bar (incl. facility), so the
  // shared header would just duplicate user/date/time/temp there.
  if (pathname?.startsWith("/reports/ice-operations")) return null

  const tempLabel =
    typeof tempF === "number"
      ? `${Math.round(tempF)}°F${tempLocation ? ` · ${tempLocation}` : ""}`
      : "Temp unavailable"

  return (
    <div
      data-report-page-header
      className="border-b border-border bg-muted/40 px-4 py-2 print:bg-white print:border-black"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-1 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <User className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span>{userName}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Clock className="h-4 w-4" aria-hidden />
          <span>{now ? formatDate(now) : "—"}</span>
          <span className="tabular-nums">{now ? formatTime(now) : ""}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Thermometer className="h-4 w-4" aria-hidden />
          <span>{tempLabel}</span>
        </div>
      </div>
    </div>
  )
}
