"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"

import { Button } from "@/components/ui/button"

import { SHORT_DAY_NAMES } from "../types"
import { formatTime } from "./format-utils"

type ShiftItem = {
  id: string
  starts_at: string
  ends_at: string
  role_label: string | null
  status: string
  departments: { name: string } | null
}

interface Props {
  shifts: ShiftItem[]
  weekStartIso: string   // YYYY-MM-DD of the week's Sunday
  timezone: string | null
}

function toISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function parseLocalDate(iso: string): Date {
  // YYYY-MM-DD -> local midnight
  const [y, m, day] = iso.split("-").map(Number)
  return new Date(y, m - 1, day)
}

export function WeekCalendar({ shifts, weekStartIso, timezone }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const weekStart = parseLocalDate(weekStartIso)

  const days: Date[] = []
  for (let i = 0; i < 7; i++) {
    days.push(addDays(weekStart, i))
  }

  function prevWeek() {
    const d = addDays(weekStart, -7)
    const sp = new URLSearchParams(searchParams.toString())
    sp.set("view", "week")
    sp.set("weekOf", toISODate(d))
    router.push(`${pathname}?${sp.toString()}`)
  }

  function nextWeek() {
    const d = addDays(weekStart, 7)
    const sp = new URLSearchParams(searchParams.toString())
    sp.set("view", "week")
    sp.set("weekOf", toISODate(d))
    router.push(`${pathname}?${sp.toString()}`)
  }

  // Format the week label e.g. "May 5 – 11, 2026"
  const weekEndDate = addDays(weekStart, 6)
  const startLabel = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  const endLabel = weekEndDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  const weekLabel = `${startLabel} – ${endLabel}`

  // Group shifts by day (local date)
  const shiftsByDay = new Map<string, ShiftItem[]>()
  for (const d of days) shiftsByDay.set(toISODate(d), [])
  for (const s of shifts) {
    const shiftDate = new Date(s.starts_at)
    const dayKey = toISODate(shiftDate)
    if (shiftsByDay.has(dayKey)) {
      shiftsByDay.get(dayKey)!.push(s)
    }
  }

  const today = toISODate(new Date())

  return (
    <div className="flex flex-col gap-3">
      {/* Week nav */}
      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="outline" size="sm" onClick={prevWeek}>
          ← Prev
        </Button>
        <span className="text-sm font-medium">{weekLabel}</span>
        <Button type="button" variant="outline" size="sm" onClick={nextWeek}>
          Next →
        </Button>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <div
          className="grid min-w-[560px]"
          style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
        >
          {/* Day headers */}
          {days.map((d) => {
            const key = toISODate(d)
            const isToday = key === today
            return (
              <div
                key={key}
                className={`border-b border-r last:border-r-0 px-2 py-2 text-center ${isToday ? "bg-primary/8" : "bg-muted/30"}`}
              >
                <div className={`text-xs font-medium ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                  {SHORT_DAY_NAMES[d.getDay()]}
                </div>
                <div className={`text-sm font-semibold tabular-nums ${isToday ? "text-primary" : ""}`}>
                  {d.getDate()}
                </div>
              </div>
            )
          })}

          {/* Shift cells */}
          {days.map((d) => {
            const key = toISODate(d)
            const dayShifts = shiftsByDay.get(key) ?? []
            const isToday = key === today
            return (
              <div
                key={key}
                className={`border-r last:border-r-0 min-h-[100px] p-1.5 flex flex-col gap-1 ${isToday ? "bg-primary/5" : ""}`}
              >
                {dayShifts.length === 0 ? (
                  <span className="mt-1 text-xs text-muted-foreground text-center opacity-50">—</span>
                ) : null}
                {dayShifts.map((s) => {
                  const colorClass =
                    s.status === "published"
                      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
                      : s.status === "cancelled"
                        ? "bg-muted text-muted-foreground opacity-60 line-through"
                        : "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-200"
                  return (
                    <div
                      key={s.id}
                      className={`rounded px-1.5 py-1 text-xs ${colorClass}`}
                    >
                      <div className="font-medium truncate">
                        {formatTime(s.starts_at, timezone)}–{formatTime(s.ends_at, timezone)}
                      </div>
                      {s.departments?.name ? (
                        <div className="truncate opacity-80">{s.departments.name}</div>
                      ) : null}
                      {s.role_label ? (
                        <div className="truncate opacity-70">{s.role_label}</div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
