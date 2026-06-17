"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"

import { dayKeyInTz } from "@/lib/timezone"

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

const NAVY = "#003B6F"
const GREEN = "#4DFF00"
const DISPLAY_FONT = "var(--font-anton), Anton, Impact, 'Arial Narrow', sans-serif"

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
        <button
          type="button"
          onClick={prevWeek}
          className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg border border-border bg-card text-foreground"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <div className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-[14px] text-[13px] font-semibold text-foreground">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
          {weekLabel}
        </div>
        <button
          type="button"
          onClick={nextWeek}
          className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg border border-border bg-card text-foreground"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* Grid */}
      <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,.05)]">
        {/* Day headers */}
        <div
          className="grid border-b border-border"
          style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
        >
          {days.map((d) => {
            const key = toISODate(d)
            const isToday = key === today
            return (
              <div
                key={key}
                className="border-r border-border px-2 py-[10px] text-center"
                style={{
                  background: isToday ? "rgba(77,255,0,.08)" : "var(--card)",
                }}
              >
                <div
                  className="text-[9.5px] font-bold uppercase tracking-[0.1em]"
                  style={{
                    color: isToday ? "var(--primary)" : "var(--muted-foreground)",
                  }}
                >
                  {SHORT_DAY_NAMES[d.getDay()]}
                </div>
                <div
                  className="text-[22px] leading-[1.1] text-foreground"
                  style={{ fontFamily: DISPLAY_FONT }}
                >
                  {d.getDate()}
                </div>
                {isToday && (
                  <div
                    className="mx-auto mt-[3px]"
                    style={{ width: 6, height: 6, borderRadius: 9999, background: GREEN }}
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Shift cells */}
        <div
          className="grid min-h-[120px]"
          style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
        >
          {days.map((d) => {
            const key = toISODate(d)
            const dayShifts = shiftsByDay.get(key) ?? []
            const isToday = key === today
            return (
              <div
                key={key}
                className="flex min-h-[120px] flex-col gap-1 border-r border-border p-1.5"
                style={{
                  background: isToday ? "rgba(77,255,0,.04)" : "var(--card)",
                }}
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
                      style={{
                        borderRadius: 7,
                        padding: "5px 7px",
                        background: isCancelled
                          ? "var(--secondary)"
                          : isPublished
                          ? "rgba(0,59,111,.15)"
                          : "rgba(14,165,233,.15)",
                        borderLeft: `3px solid ${isCancelled ? "#9DB2C8" : isPublished ? NAVY : "#0EA5E9"}`,
                        opacity: isCancelled ? 0.55 : 1,
                      }}
                    >
                      <div
                        className="text-[10.5px] font-bold"
                        style={{
                          color: isCancelled ? "var(--muted-foreground)" : "var(--foreground)",
                          textDecoration: isCancelled ? "line-through" : "none",
                          fontVariantNumeric: "tabular-nums",
                        }}
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
