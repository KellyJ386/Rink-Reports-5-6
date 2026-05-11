"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"

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
const NAVY_LIGHT = "#0055A3"
const GREEN = "#4DFF00"
const GREEN_INK = "#1F6B00"
const GREY = "#A5ACAF"
const LINE = "#e5e7eb"
const LINE_SOFT = "#f3f4f6"
const RED = "#F42A2A"
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
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Week nav */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <button
          type="button"
          onClick={prevWeek}
          style={{
            width: 36, height: 36, borderRadius: 8, border: `1px solid ${LINE}`,
            background: "#fff", color: NAVY, cursor: "pointer",
            display: "grid", placeItems: "center",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <div style={{
          padding: "0 14px", height: 36, borderRadius: 8, background: "#fff",
          border: `1px solid ${LINE}`, display: "flex", alignItems: "center",
          color: NAVY, fontSize: 13, fontWeight: 600, gap: 6,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
          {weekLabel}
        </div>
        <button
          type="button"
          onClick={nextWeek}
          style={{
            width: 36, height: 36, borderRadius: 8, border: `1px solid ${LINE}`,
            background: "#fff", color: NAVY, cursor: "pointer",
            display: "grid", placeItems: "center",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* Grid */}
      <div style={{
        background: "#fff", border: `1px solid ${LINE}`, borderRadius: 14,
        overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,.05)",
      }}>
        {/* Day headers */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          borderBottom: `1px solid ${LINE}`,
        }}>
          {days.map((d) => {
            const key = toISODate(d)
            const isToday = key === today
            return (
              <div
                key={key}
                style={{
                  borderRight: `1px solid ${LINE}`,
                  padding: "10px 8px",
                  textAlign: "center",
                  background: isToday ? "rgba(77,255,0,.08)" : "#fff",
                }}
              >
                <div style={{
                  fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em",
                  textTransform: "uppercase",
                  color: isToday ? GREEN_INK : GREY,
                }}>
                  {SHORT_DAY_NAMES[d.getDay()]}
                </div>
                <div style={{
                  fontFamily: DISPLAY_FONT,
                  fontSize: 22, lineHeight: 1.1,
                  color: isToday ? NAVY : NAVY,
                }}>
                  {d.getDate()}
                </div>
                {isToday && (
                  <div style={{
                    width: 6, height: 6, borderRadius: 9999,
                    background: GREEN, margin: "3px auto 0",
                  }} />
                )}
              </div>
            )
          })}
        </div>

        {/* Shift cells */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          minHeight: 120,
        }}>
          {days.map((d) => {
            const key = toISODate(d)
            const dayShifts = shiftsByDay.get(key) ?? []
            const isToday = key === today
            return (
              <div
                key={key}
                style={{
                  borderRight: `1px solid ${LINE}`,
                  minHeight: 120,
                  padding: 6,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  background: isToday ? "rgba(77,255,0,.03)" : "#fff",
                }}
              >
                {dayShifts.length === 0 && (
                  <span style={{
                    display: "block", marginTop: 8, fontSize: 11,
                    color: LINE, textAlign: "center",
                  }}>—</span>
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
                          ? LINE_SOFT
                          : isPublished
                          ? "rgba(0,59,111,.08)"
                          : "rgba(14,165,233,.10)",
                        borderLeft: `3px solid ${isCancelled ? GREY : isPublished ? NAVY : "#0EA5E9"}`,
                        opacity: isCancelled ? 0.55 : 1,
                      }}
                    >
                      <div style={{
                        fontSize: 10.5, fontWeight: 700,
                        color: isCancelled ? GREY : NAVY,
                        textDecoration: isCancelled ? "line-through" : "none",
                        fontVariantNumeric: "tabular-nums",
                      }}>
                        {formatTime(s.starts_at, timezone)}–{formatTime(s.ends_at, timezone)}
                      </div>
                      {s.departments?.name ? (
                        <div style={{ fontSize: 10, color: GREY, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.departments.name}
                        </div>
                      ) : null}
                      {s.role_label ? (
                        <div style={{ fontSize: 9.5, color: GREY, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.7 }}>
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
