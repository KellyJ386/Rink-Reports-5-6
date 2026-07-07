"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { dayKeyInTz } from "@/lib/timezone"
import { cn } from "@/lib/utils"

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

  const weekEndDate = addDays(weekStart, 6)
  const startLabel = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  const endLabel = weekEndDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  const weekLabel = `${startLabel} – ${endLabel}`

  // Bucket each shift onto the FACILITY's calendar day (times are displayed
  // in the facility timezone, so the column must match).
  const shiftsByDay = new Map<string, ShiftItem[]>()
  for (const d of days) shiftsByDay.set(toISODate(d), [])
  for (const s of shifts) {
    const dayKey = dayKeyInTz(s.starts_at, timezone)
    if (shiftsByDay.has(dayKey)) {
      shiftsByDay.get(dayKey)!.push(s)
    }
  }

  const today = dayKeyInTz(new Date(), timezone)

  return (
    <div className="flex flex-col gap-3">
      {/* Week nav */}
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9"
          onClick={prevWeek}
          aria-label="Previous week"
        >
          <ChevronLeft aria-hidden />
        </Button>
        <div className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 text-[13px] font-semibold text-foreground">
          <Calendar className="h-3.5 w-3.5" aria-hidden />
          {weekLabel}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9"
          onClick={nextWeek}
          aria-label="Next week"
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>

      {/* Grid */}
      <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-[var(--shadow-elev-1)]">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-border">
          {days.map((d) => {
            const key = toISODate(d)
            const isToday = key === today
            return (
              <div
                key={key}
                className={cn(
                  "border-r border-border px-2 py-2.5 text-center",
                  isToday ? "bg-primary/10" : "bg-card"
                )}
              >
                <div
                  className={cn(
                    "text-[9.5px] font-bold uppercase tracking-[0.1em]",
                    isToday ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  {SHORT_DAY_NAMES[d.getDay()]}
                </div>
                <div className="font-display text-[22px] leading-[1.1] text-foreground">
                  {d.getDate()}
                </div>
                {isToday && (
                  <div className="mx-auto mt-[3px] h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </div>
            )
          })}
        </div>

        {/* Shift cells */}
        <div className="grid min-h-[120px] grid-cols-7">
          {days.map((d) => {
            const key = toISODate(d)
            const dayShifts = shiftsByDay.get(key) ?? []
            const isToday = key === today
            return (
              <div
                key={key}
                className={cn(
                  "flex min-h-[120px] flex-col gap-1 border-r border-border p-1.5",
                  isToday ? "bg-primary/5" : "bg-card"
                )}
              >
                {dayShifts.length === 0 && (
                  <span className="mt-2 block text-center text-[11px] text-border">—</span>
                )}
                {dayShifts.map((s) => {
                  const isPublished = s.status === "published"
                  const isCancelled = s.status === "cancelled"
                  return (
                    <div
                      key={s.id}
                      className={cn(
                        "rounded-md border-l-[3px] px-[7px] py-[5px]",
                        isCancelled
                          ? "border-l-[var(--muted-foreground)] bg-secondary opacity-55"
                          : isPublished
                            ? "border-l-[var(--navy-500)] bg-[var(--navy-500)]/15"
                            : "border-l-[var(--info)] bg-info/15"
                      )}
                    >
                      <div
                        className={cn(
                          "text-[10.5px] font-bold tabular-nums",
                          isCancelled
                            ? "text-muted-foreground line-through"
                            : "text-foreground"
                        )}
                      >
                        {formatTime(s.starts_at, timezone)}–{formatTime(s.ends_at, timezone)}
                      </div>
                      {s.departments?.name ? (
                        <div className="mt-px overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-muted-foreground">
                          {s.departments.name}
                        </div>
                      ) : null}
                      {s.role_label ? (
                        <div className="mt-px overflow-hidden text-ellipsis whitespace-nowrap text-[9.5px] text-muted-foreground opacity-70">
                          {s.role_label}
                        </div>
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
