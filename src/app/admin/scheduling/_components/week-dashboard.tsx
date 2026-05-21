"use client"

import { useMemo, useState } from "react"
import Link from "next/link"

const rr = {
  navy: "#003B6F",
  navyLight: "#0055A3",
  navyDark: "#001A3A",
  green: "#4DFF00",
  greenLight: "#7AFF40",
  greenDark: "#3DB800",
  greenInk: "#1F6B00",
  grey: "#A5ACAF",
  greyLight: "#BFC4C6",
  greyDark: "#8A9194",
  yellow: "#FFB800",
  yellowDark: "#CC9300",
  red: "#F42A2A",
  redDark: "#C62828",
  bg: "#f1f3f5",
  bg2: "#f8f9fa",
  line: "#e5e7eb",
  lineSoft: "#f3f4f6",
} as const

// Theme-aware tokens — read from globals.css. The EmployeePhone preview
// keeps the raw `rr.*` constants because it depicts a phone screen and
// is intentionally light in both modes.
const surface = "var(--card)"
const pageBg = "var(--background)"
const subtleBg = "var(--secondary)"
const line = "var(--border)"
const textPrimary = "var(--foreground)"
const textMuted = "var(--muted-foreground)"
const brandNavy = "var(--brand-navy)"

const DAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const

type ShiftBlock = {
  id: string
  day: number
  startHour: number
  endHour: number
  employeeId: string | null
  employeeName: string | null
  employeeInitials: string | null
  employeeHue: number
  departmentId: string
  departmentName: string
  departmentColor: string
  status: string
  swapPending: boolean
  roleLabel: string | null
}

type OpenShift = {
  id: string
  day: number
  startHour: number
  endHour: number
  departmentName: string
  departmentColor: string
  note: string | null
}

type SwapItem = {
  id: string
  fromName: string
  fromInitials: string
  fromHue: number
  toName: string | null
  toInitials: string | null
  toHue: number
  day: number
  startHour: number
  endHour: number
  status: string
  reason: string | null
}

type TimeOffItem = {
  id: string
  employeeName: string
  employeeInitials: string
  employeeHue: number
  fromLabel: string
  toLabel: string
  reason: string | null
  status: string
}

type CrewMember = {
  id: string
  name: string
  initials: string
  hue: number
  departmentName: string
  departmentColor: string
  hours: number
}

export type WeekDashboardProps = {
  weekLabel: string
  weekDates: number[]
  facilityName: string
  todayIndex: number | null
  nowFractionalHour: number | null
  shifts: ShiftBlock[]
  openShifts: OpenShift[]
  swaps: SwapItem[]
  timeOff: TimeOffItem[]
  crew: CrewMember[]
  totalScheduledHours: number
  laborCostEstimate: number
  employeeViewName: string | null
  employeeViewHue: number
  employeeViewRoleLabel: string | null
  employeeViewShifts: ShiftBlock[]
}

type View = "day" | "week" | "month"
type Density = "compact" | "comfortable" | "spacious"
type ColorBy = "role" | "person"

function fmtHour(h: number) {
  const hr = Math.floor(h)
  const m = Math.round((h - hr) * 60)
  const ampm = hr >= 12 ? "p" : "a"
  const hh = ((hr + 11) % 12) + 1
  return m ? `${hh}:${m.toString().padStart(2, "0")}${ampm}` : `${hh}${ampm}`
}

function hexWithAlpha(hex: string, alpha: number) {
  const h = hex.replace("#", "")
  const full =
    h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0")
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function NavIcon({ path, size = 18 }: { path: React.ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {path}
    </svg>
  )
}

const ICONS = {
  cal: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  chev: <path d="m9 18 6-6-6-6" />,
  chevL: <path d="m15 18-6-6 6-6" />,
  pub: (
    <>
      <path d="m22 2-11 11" />
      <path d="m22 2-7 20-4-9-9-4 20-7z" />
    </>
  ),
  sliders: (
    <>
      <line x1="4" x2="4" y1="21" y2="14" />
      <line x1="4" x2="4" y1="10" y2="3" />
      <line x1="12" x2="12" y1="21" y2="12" />
      <line x1="12" x2="12" y1="8" y2="3" />
      <line x1="20" x2="20" y1="21" y2="16" />
      <line x1="20" x2="20" y1="12" y2="3" />
      <line x1="2" x2="6" y1="14" y2="14" />
      <line x1="10" x2="14" y1="8" y2="8" />
      <line x1="18" x2="22" y1="16" y2="16" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.9 1.8 18A2 2 0 0 0 3.5 21h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  arrow: (
    <>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </>
  ),
  check: <path d="m20 6-11 11-5-5" />,
  x: (
    <>
      <path d="m18 6-12 12M6 6l12 12" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5M12 15V3" />
    </>
  ),
  dashboard: (
    <>
      <path d="M3 12l9-9 9 9" />
      <path d="M5 10v10h14V10" />
    </>
  ),
  msg: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
}

function Avatar({
  initials,
  hue,
  size = 32,
}: {
  initials: string
  hue: number
  size?: number
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 9999,
        background: `oklch(0.6 0.18 ${hue})`,
        color: "#fff",
        display: "grid",
        placeItems: "center",
        fontWeight: 800,
        fontSize: size * 0.36,
        flexShrink: 0,
        boxShadow: "inset 0 -2px 0 rgba(0,0,0,.10)",
      }}
    >
      {initials}
    </div>
  )
}

function shiftColors(s: ShiftBlock, colorBy: ColorBy) {
  if (colorBy === "role") {
    const color = s.departmentColor
    return {
      fg: color,
      bg: hexWithAlpha(color, 0.14),
      edge: color,
    }
  }
  return {
    fg: `oklch(0.40 0.16 ${s.employeeHue})`,
    bg: `oklch(0.95 0.05 ${s.employeeHue})`,
    edge: `oklch(0.55 0.18 ${s.employeeHue})`,
  }
}

function ViewSwitcher({
  view,
  onView,
}: {
  view: View
  onView: (v: View) => void
}) {
  const opts: View[] = ["day", "week", "month"]
  return (
    <div
      style={{
        display: "flex",
        gap: 3,
        background: surface,
        border: `1px solid ${line}`,
        borderRadius: 9,
        padding: 3,
      }}
    >
      {opts.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onView(v)}
          style={{
            padding: "7px 16px",
            fontSize: 12.5,
            fontWeight: 700,
            border: 0,
            borderRadius: 6,
            background: view === v ? brandNavy : "transparent",
            color: view === v ? "#fff" : textPrimary,
            cursor: "pointer",
            textTransform: "uppercase",
            letterSpacing: ".04em",
          }}
        >
          {v}
        </button>
      ))}
    </div>
  )
}

function ColorBySwitcher({
  value,
  onChange,
}: {
  value: ColorBy
  onChange: (v: ColorBy) => void
}) {
  const opts: { id: ColorBy; label: string }[] = [
    { id: "role", label: "By role" },
    { id: "person", label: "By person" },
  ]
  return (
    <div
      style={{
        display: "flex",
        gap: 3,
        background: surface,
        border: `1px solid ${line}`,
        borderRadius: 9,
        padding: 3,
      }}
    >
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          style={{
            padding: "7px 12px",
            fontSize: 12,
            fontWeight: 600,
            border: 0,
            borderRadius: 6,
            background: value === o.id ? subtleBg : "transparent",
            color: value === o.id ? textPrimary : textMuted,
            cursor: "pointer",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ToolbarToggle({
  on,
  onClick,
  children,
  icon,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
  icon: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "7px 12px",
        height: 36,
        fontSize: 12.5,
        fontWeight: 600,
        cursor: "pointer",
        border: `1px solid ${on ? brandNavy : line}`,
        borderRadius: 8,
        background: on ? brandNavy : surface,
        color: on ? "#fff" : textPrimary,
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {icon}
      {children}
    </button>
  )
}

function Kpi({
  label,
  value,
  sub,
  accent,
  icon,
}: {
  label: string
  value: React.ReactNode
  sub: string
  accent: string
  icon: React.ReactNode
}) {
  return (
    <div
      style={{
        background: surface,
        border: `1px solid ${line}`,
        borderRadius: 12,
        padding: 14,
        flex: 1,
        minWidth: 0,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          color: accent,
          opacity: 0.7,
        }}
      >
        {icon}
      </div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: ".14em",
          color: textMuted,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-anton), 'Anton', Impact",
          fontSize: 32,
          color: accent,
          marginTop: 4,
          lineHeight: 1,
          letterSpacing: "-.01em",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 12, color: textMuted, marginTop: 6 }}>{sub}</div>
    </div>
  )
}

function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section
      style={{
        background: surface,
        border: `1px solid ${line}`,
        borderRadius: 12,
        boxShadow: "0 1px 2px rgba(0,0,0,.04)",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          padding: "12px 14px",
          borderBottom: `1px solid ${line}`,
          gap: 10,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontFamily: "var(--font-anton), 'Anton', Impact",
            fontSize: 15,
            textTransform: "uppercase",
            color: textPrimary,
            letterSpacing: ".02em",
          }}
        >
          {title}
        </h3>
        <div style={{ flex: 1 }} />
        {action}
      </header>
      <div>{children}</div>
    </section>
  )
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ padding: "8px 10px", background: subtleBg, borderRadius: 8 }}>
      <div
        style={{
          fontSize: 10,
          color: textMuted,
          fontWeight: 700,
          letterSpacing: ".1em",
          textTransform: "uppercase",
        }}
      >
        {k}
      </div>
      <div
        style={{
          fontSize: 13,
          color: textPrimary,
          fontWeight: 600,
          marginTop: 2,
        }}
      >
        {v}
      </div>
    </div>
  )
}

function WeekGrid({
  density,
  colorBy,
  showHeatmap,
  todayIndex,
  nowFractionalHour,
  weekDates,
  shifts,
  selected,
  onSelect,
}: {
  density: Density
  colorBy: ColorBy
  showHeatmap: boolean
  todayIndex: number | null
  nowFractionalHour: number | null
  weekDates: number[]
  shifts: ShiftBlock[]
  selected: string | null
  onSelect: (id: string) => void
}) {
  const hourStart = 5
  const hourEnd = 23
  const hours = useMemo(
    () =>
      Array.from(
        { length: hourEnd - hourStart + 1 },
        (_, i) => i + hourStart
      ),
    []
  )
  const HR = density === "compact" ? 22 : density === "spacious" ? 38 : 30
  const HEAD = 64

  const coverage = useMemo(() => {
    const grid = Array.from({ length: 7 }, () => Array(hours.length).fill(0))
    shifts.forEach((sh) => {
      hours.forEach((h, hi) => {
        if (h >= sh.startHour && h < sh.endHour) grid[sh.day][hi] += 1
      })
    })
    return grid
  }, [hours, shifts])

  return (
    <div
      style={{
        background: surface,
        border: `1px solid ${line}`,
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 1px 3px rgba(0,0,0,.05)",
        position: "relative",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "64px repeat(7,1fr)",
          borderBottom: `1px solid ${line}`,
          background: surface,
          position: "sticky",
          top: 0,
          zIndex: 5,
        }}
      >
        <div />
        {DAY_LABELS.map((d, i) => {
          const isToday = i === todayIndex
          const cnt = shifts.filter((s) => s.day === i).length
          return (
            <div
              key={d}
              style={{
                padding: "10px 12px",
                borderLeft: `1px solid ${line}`,
                background: isToday ? "rgba(77,255,0,.08)" : surface,
                display: "flex",
                alignItems: "center",
                gap: 10,
                height: HEAD,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: ".12em",
                    color: isToday ? rr.greenInk : textMuted,
                  }}
                >
                  {d}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-anton), 'Anton', Impact",
                    fontSize: 28,
                    lineHeight: 1,
                    color: textPrimary,
                    marginTop: 2,
                  }}
                >
                  {weekDates[i]}
                </div>
              </div>
              <div style={{ marginLeft: "auto", textAlign: "right" }}>
                <div
                  style={{
                    fontSize: 10,
                    color: textMuted,
                    fontWeight: 600,
                    letterSpacing: ".08em",
                  }}
                >
                  SHIFTS
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontWeight: 600,
                    color: textPrimary,
                    marginTop: 2,
                  }}
                >
                  {cnt}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "64px repeat(7,1fr)",
        }}
      >
        <div style={{ borderRight: `1px solid ${line}`, background: subtleBg }}>
          {hours.map((h) => (
            <div
              key={h}
              style={{
                height: HR,
                padding: "0 10px",
                textAlign: "right",
                lineHeight: `${HR}px`,
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10.5,
                color: textMuted,
                borderBottom: `1px solid ${line}`,
              }}
            >
              {fmtHour(h)}
            </div>
          ))}
        </div>
        {DAY_LABELS.map((_, di) => {
          const isToday = di === todayIndex
          return (
            <div
              key={di}
              style={{
                borderLeft: `1px solid ${line}`,
                position: "relative",
                background: isToday ? "rgba(77,255,0,.025)" : surface,
              }}
            >
              {hours.map((h, hi) => {
                let bg = "transparent"
                if (showHeatmap) {
                  const c = coverage[di][hi]
                  const alpha = Math.min(0.18, c * 0.04)
                  bg = `rgba(77,255,0,${alpha})`
                  if (c === 0 && h >= 7 && h < 21)
                    bg = "rgba(244,42,42,.05)"
                }
                return (
                  <div
                    key={h}
                    style={{
                      height: HR,
                      borderBottom: `1px solid ${line}`,
                      background: bg,
                    }}
                  />
                )
              })}
              {shifts
                .filter((s) => s.day === di)
                .map((s) => {
                  const top = (s.startHour - hourStart) * HR + 1
                  const height = (s.endHour - s.startHour) * HR - 2
                  const col = shiftColors(s, colorBy)
                  const isSelected = selected === s.id
                  const firstName = (s.employeeName ?? "Open").split(" ")[0]
                  return (
                    <div
                      key={s.id}
                      onClick={() => onSelect(s.id)}
                      style={{
                        position: "absolute",
                        left: 4,
                        right: 4,
                        top,
                        height,
                        background: col.bg,
                        border: `1px solid ${col.edge}`,
                        borderLeft: `3px solid ${col.edge}`,
                        borderRadius: 7,
                        padding:
                          density === "compact" ? "4px 6px" : "6px 8px",
                        overflow: "hidden",
                        cursor: "pointer",
                        boxShadow: isSelected
                          ? `0 0 0 2px ${rr.green}, 0 4px 12px rgba(0,0,0,.12)`
                          : "none",
                        transition: "box-shadow .15s, transform .15s",
                        transform: isSelected ? "translateY(-1px)" : "none",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          lineHeight: 1.15,
                        }}
                      >
                        <div
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 9999,
                            background: col.edge,
                            color: "#fff",
                            fontSize: 9,
                            fontWeight: 800,
                            display: "grid",
                            placeItems: "center",
                            flexShrink: 0,
                          }}
                        >
                          {s.employeeInitials ?? "—"}
                        </div>
                        <div
                          style={{
                            fontSize: 11.5,
                            fontWeight: 700,
                            color: col.fg,
                            lineHeight: 1.1,
                            minWidth: 0,
                          }}
                        >
                          {firstName}
                          {s.swapPending && (
                            <span
                              style={{
                                marginLeft: 6,
                                fontSize: 8.5,
                                padding: "1px 5px",
                                borderRadius: 9999,
                                background: rr.yellow,
                                color: textPrimary,
                                fontWeight: 800,
                                letterSpacing: ".04em",
                              }}
                            >
                              SWAP
                            </span>
                          )}
                        </div>
                      </div>
                      {height >= 32 && (
                        <div
                          style={{
                            fontSize: 10,
                            fontFamily: "var(--font-geist-mono), monospace",
                            color: col.fg,
                            opacity: 0.8,
                            marginTop: 3,
                          }}
                        >
                          {fmtHour(s.startHour)}–{fmtHour(s.endHour)}
                        </div>
                      )}
                      {height >= 56 && (
                        <div
                          style={{
                            fontSize: 9.5,
                            color: col.fg,
                            opacity: 0.75,
                            marginTop: 3,
                            letterSpacing: ".06em",
                            textTransform: "uppercase",
                            fontWeight: 600,
                          }}
                        >
                          {s.departmentName}
                        </div>
                      )}
                    </div>
                  )
                })}
              {isToday && nowFractionalHour != null && (
                <div
                  style={{
                    position: "absolute",
                    left: -2,
                    right: 0,
                    top: (nowFractionalHour - hourStart) * HR,
                    height: 2,
                    background: rr.red,
                    zIndex: 3,
                    boxShadow: "0 0 8px rgba(244,42,42,.6)",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: -6,
                      top: -4,
                      width: 10,
                      height: 10,
                      borderRadius: 9999,
                      background: rr.red,
                      boxShadow: "0 0 0 3px rgba(244,42,42,.25)",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      right: 4,
                      top: -16,
                      fontSize: 9.5,
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontWeight: 700,
                      color: rr.red,
                      background: surface,
                      padding: "1px 5px",
                      borderRadius: 4,
                      border: `1px solid ${rr.red}`,
                    }}
                  >
                    {fmtHour(nowFractionalHour).toUpperCase()} NOW
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ShiftDetail({
  shift,
  weekDates,
  onClose,
}: {
  shift: ShiftBlock
  weekDates: number[]
  onClose: () => void
}) {
  const dur = shift.endHour - shift.startHour
  const color = shift.departmentColor
  return (
    <div
      style={{
        background: surface,
        border: `1px solid ${line}`,
        borderRadius: 12,
        boxShadow: "0 8px 30px rgba(0,0,0,.10)",
        padding: 18,
        position: "relative",
      }}
    >
      <button
        type="button"
        onClick={onClose}
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          width: 28,
          height: 28,
          borderRadius: 9999,
          border: 0,
          background: subtleBg,
          cursor: "pointer",
          color: textMuted,
          display: "grid",
          placeItems: "center",
        }}
      >
        <NavIcon path={ICONS.x} size={14} />
      </button>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: ".14em",
          color,
          textTransform: "uppercase",
        }}
      >
        Shift detail
      </div>
      <h2
        style={{
          margin: "6px 0 14px",
          fontFamily: "var(--font-anton), 'Anton', Impact",
          fontSize: 26,
          textTransform: "uppercase",
          color: textPrimary,
          letterSpacing: "-.01em",
        }}
      >
        {DAY_LABELS[shift.day]} {weekDates[shift.day]} ·{" "}
        {fmtHour(shift.startHour)}–{fmtHour(shift.endHour)}
      </h2>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: 12,
          background: subtleBg,
          borderRadius: 10,
          marginBottom: 14,
        }}
      >
        {shift.employeeInitials ? (
          <Avatar
            initials={shift.employeeInitials}
            hue={shift.employeeHue}
            size={44}
          />
        ) : (
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 9999,
              background: pageBg,
              border: `1px dashed ${rr.greyLight}`,
              color: textMuted,
              display: "grid",
              placeItems: "center",
              fontWeight: 700,
              fontSize: 11,
            }}
          >
            OPEN
          </div>
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: textPrimary }}>
            {shift.employeeName ?? "Unassigned"}
          </div>
          <div style={{ fontSize: 12, color, fontWeight: 600 }}>
            {shift.roleLabel ?? shift.departmentName}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontFamily: "var(--font-anton), 'Anton', Impact",
              fontSize: 24,
              color: textPrimary,
            }}
          >
            {dur}h
          </div>
          <div
            style={{
              fontSize: 10,
              color: textMuted,
              letterSpacing: ".1em",
            }}
          >
            DURATION
          </div>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <Detail k="Department" v={shift.departmentName} />
        <Detail k="Status" v={shift.status} />
        <Detail k="Est. pay" v={`$${dur * 26}`} />
        <Detail k="Pre-op check" v="Required" />
      </div>
      {shift.swapPending && (
        <div
          style={{
            padding: 10,
            borderRadius: 8,
            background: "rgba(255,184,0,.12)",
            border: "1px solid rgba(255,184,0,.4)",
            marginBottom: 12,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: rr.yellowDark,
              letterSpacing: ".08em",
            }}
          >
            SWAP PENDING
          </div>
          <div style={{ fontSize: 12, color: textPrimary, marginTop: 2 }}>
            Awaiting manager approval
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <Link
          href={`/admin/scheduling/shifts?shift=${shift.id}`}
          style={{
            flex: 1,
            padding: "10px",
            border: 0,
            borderRadius: 8,
            background: brandNavy,
            color: "#fff",
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
            textAlign: "center",
            textDecoration: "none",
          }}
        >
          Edit shift
        </Link>
        <button
          type="button"
          style={{
            padding: "10px 14px",
            border: `1px solid ${line}`,
            borderRadius: 8,
            background: surface,
            color: textPrimary,
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <NavIcon path={ICONS.copy} size={14} /> Duplicate
        </button>
        <button
          type="button"
          style={{
            padding: "10px 14px",
            border: `1px solid ${rr.red}`,
            borderRadius: 8,
            background: surface,
            color: rr.red,
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Delete
        </button>
      </div>
    </div>
  )
}

function OpenShiftsPanel({
  openShifts,
  weekDates,
}: {
  openShifts: OpenShift[]
  weekDates: number[]
}) {
  return (
    <Section
      title={`Open shifts · ${openShifts.length}`}
      action={
        <Link
          href="/admin/scheduling/shifts"
          style={{
            border: 0,
            background: "transparent",
            color: rr.navyLight,
            fontWeight: 600,
            fontSize: 12,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
            textDecoration: "none",
          }}
        >
          Post all <NavIcon path={ICONS.arrow} size={12} />
        </Link>
      }
    >
      {openShifts.length === 0 ? (
        <div style={{ padding: 14, fontSize: 12.5, color: textMuted }}>
          No open shifts this week.
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {openShifts.map((o, i) => (
            <li
              key={o.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                borderBottom:
                  i === openShifts.length - 1
                    ? 0
                    : `1px solid ${line}`,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 48,
                  borderRadius: 9,
                  background: hexWithAlpha(o.departmentColor, 0.12),
                  color: o.departmentColor,
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                  border: `1px solid ${hexWithAlpha(o.departmentColor, 0.3)}`,
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 800,
                    letterSpacing: ".12em",
                  }}
                >
                  {DAY_LABELS[o.day]}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-anton), 'Anton', Impact",
                    fontSize: 18,
                    lineHeight: 1,
                  }}
                >
                  {weekDates[o.day]}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: textPrimary }}>
                  {fmtHour(o.startHour)} – {fmtHour(o.endHour)} ·{" "}
                  <span style={{ color: o.departmentColor }}>
                    {o.departmentName}
                  </span>
                </div>
                <div
                  style={{ fontSize: 11.5, color: textMuted, marginTop: 2 }}
                >
                  {o.note ?? "Open coverage"} · {o.endHour - o.startHour} hr
                </div>
              </div>
              <button
                type="button"
                style={{
                  padding: "7px 12px",
                  border: `1px solid ${brandNavy}`,
                  borderRadius: 7,
                  background: surface,
                  color: textPrimary,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Assign
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function SwapsPanel({
  swaps,
  weekDates,
}: {
  swaps: SwapItem[]
  weekDates: number[]
}) {
  return (
    <Section title="Swap requests">
      {swaps.length === 0 ? (
        <div style={{ padding: 14, fontSize: 12.5, color: textMuted }}>
          No swap requests.
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {swaps.map((sw, i) => {
            const isPending = sw.status === "pending"
            return (
              <li
                key={sw.id}
                style={{
                  padding: "12px 14px",
                  borderBottom:
                    i === swaps.length - 1 ? 0 : `1px solid ${line}`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 8,
                  }}
                >
                  <Avatar
                    initials={sw.fromInitials}
                    hue={sw.fromHue}
                    size={28}
                  />
                  <div style={{ color: textMuted, fontSize: 11 }}>→</div>
                  {sw.toInitials ? (
                    <Avatar
                      initials={sw.toInitials}
                      hue={sw.toHue}
                      size={28}
                    />
                  ) : (
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 9999,
                        background: subtleBg,
                        border: `1px dashed ${rr.greyLight}`,
                      }}
                    />
                  )}
                  <div
                    style={{ flex: 1, fontSize: 12.5, color: textPrimary }}
                  >
                    <strong>{sw.fromName.split(" ")[0]}</strong> →{" "}
                    <strong>
                      {sw.toName ? sw.toName.split(" ")[0] : "Anyone"}
                    </strong>
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 7px",
                      borderRadius: 9999,
                      background: isPending
                        ? "rgba(255,184,0,.18)"
                        : "rgba(77,255,0,.18)",
                      color: isPending ? rr.yellowDark : rr.greenInk,
                      letterSpacing: ".06em",
                    }}
                  >
                    {sw.status.toUpperCase()}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    color: textMuted,
                    marginBottom: isPending ? 10 : 0,
                  }}
                >
                  {DAY_LABELS[sw.day]} {weekDates[sw.day]} ·{" "}
                  {fmtHour(sw.startHour)}–{fmtHour(sw.endHour)}
                  {sw.reason ? ` · ${sw.reason}` : ""}
                </div>
                {isPending && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      style={{
                        flex: 1,
                        padding: "7px 10px",
                        border: 0,
                        borderRadius: 7,
                        background: rr.green,
                        color: textPrimary,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        boxShadow: "0 2px 0 0 #2E9900",
                      }}
                    >
                      <NavIcon path={ICONS.check} size={13} /> Approve
                    </button>
                    <button
                      type="button"
                      style={{
                        flex: 1,
                        padding: "7px 10px",
                        border: `1px solid ${line}`,
                        borderRadius: 7,
                        background: surface,
                        color: textPrimary,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Deny
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

function TimeOffPanel({ timeOff }: { timeOff: TimeOffItem[] }) {
  return (
    <Section title="Time-off requests">
      {timeOff.length === 0 ? (
        <div style={{ padding: 14, fontSize: 12.5, color: textMuted }}>
          No time-off requests.
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {timeOff.map((t, i) => (
            <li
              key={t.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 14px",
                borderBottom:
                  i === timeOff.length - 1 ? 0 : `1px solid ${line}`,
              }}
            >
              <Avatar
                initials={t.employeeInitials}
                hue={t.employeeHue}
                size={32}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: textPrimary }}>
                  {t.employeeName}
                </div>
                <div style={{ fontSize: 11.5, color: textMuted }}>
                  {t.fromLabel} – {t.toLabel}
                  {t.reason ? ` · ${t.reason}` : ""}
                </div>
              </div>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "2px 7px",
                  borderRadius: 9999,
                  background:
                    t.status === "pending"
                      ? "rgba(255,184,0,.18)"
                      : "rgba(77,255,0,.18)",
                  color:
                    t.status === "pending" ? rr.yellowDark : rr.greenInk,
                  letterSpacing: ".06em",
                }}
              >
                {t.status.toUpperCase()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function CrewRosterPanel({ crew }: { crew: CrewMember[] }) {
  return (
    <Section title={`Crew · ${crew.length}`}>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          maxHeight: 380,
          overflowY: "auto",
        }}
      >
        {crew.map((c) => {
          const over = c.hours > 40
          return (
            <li
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                borderBottom: `1px solid ${line}`,
              }}
            >
              <Avatar initials={c.initials} hue={c.hue} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: textPrimary }}>
                  {c.name}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: c.departmentColor,
                    fontWeight: 600,
                  }}
                >
                  {c.departmentName}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontWeight: 600,
                    fontSize: 13,
                    color: over ? rr.red : textPrimary,
                  }}
                >
                  {c.hours}h
                </div>
                <div
                  style={{
                    fontSize: 9.5,
                    color: textMuted,
                    letterSpacing: ".08em",
                  }}
                >
                  / 40
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

function LegendRoles({
  colorBy,
  departments,
}: {
  colorBy: ColorBy
  departments: { name: string; color: string }[]
}) {
  if (colorBy !== "role") return null
  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      {departments.map((d) => (
        <div
          key={d.name}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11.5,
            color: textPrimary,
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 4,
              background: hexWithAlpha(d.color, 0.14),
              border: `1.5px solid ${d.color}`,
            }}
          />
          {d.name}
        </div>
      ))}
    </div>
  )
}

function EmployeePhone({
  employeeName,
  hue,
  roleLabel,
  shifts,
  weekDates,
  openShifts,
  todayIndex,
}: {
  employeeName: string | null
  hue: number
  roleLabel: string | null
  shifts: ShiftBlock[]
  weekDates: number[]
  openShifts: OpenShift[]
  todayIndex: number | null
}) {
  const initials = employeeName
    ? employeeName
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "—"
  const sorted = [...shifts].sort((a, b) => a.day - b.day)
  const next =
    sorted.find((s) => (todayIndex == null ? true : s.day >= todayIndex)) ??
    sorted[0] ??
    null

  return (
    <div
      style={{
        width: 320,
        height: 640,
        background: "#000",
        borderRadius: 44,
        padding: 10,
        boxShadow:
          "0 30px 60px -15px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.05)",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          background: rr.bg,
          borderRadius: 36,
          overflow: "hidden",
          position: "relative",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 8,
            left: "50%",
            transform: "translateX(-50%)",
            width: 100,
            height: 26,
            background: "#000",
            borderRadius: 13,
            zIndex: 10,
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "12px 24px 4px",
            fontSize: 13,
            fontWeight: 700,
            color: rr.navyDark,
          }}
        >
          <span>9:41</span>
          <span
            style={{ display: "flex", gap: 4, alignItems: "center" }}
          >
            <span style={{ fontSize: 10 }}>●●●●</span>
            <span style={{ fontSize: 10 }}>5G</span>
            <span>▮▮</span>
          </span>
        </div>

        <div
          style={{
            padding: "14px 18px 8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: ".14em",
                color: rr.greyDark,
              }}
            >
              HEY {(employeeName ?? "").split(" ")[0]?.toUpperCase()}
            </div>
            <div
              style={{
                fontFamily: "var(--font-anton), 'Anton', Impact",
                fontSize: 24,
                color: rr.navy,
                textTransform: "uppercase",
                marginTop: 2,
              }}
            >
              My schedule
            </div>
          </div>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 9999,
              background: `oklch(0.6 0.18 ${hue})`,
              color: "#fff",
              display: "grid",
              placeItems: "center",
              fontWeight: 800,
              fontSize: 12,
            }}
          >
            {initials}
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "6px 16px 18px" }}>
          {next && (
            <div
              style={{
                background: `linear-gradient(135deg, ${rr.navy} 0%, ${rr.navyDark} 100%)`,
                borderRadius: 16,
                padding: 16,
                color: "#fff",
                position: "relative",
                overflow: "hidden",
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: -30,
                  right: -30,
                  width: 120,
                  height: 120,
                  borderRadius: 9999,
                  background:
                    "radial-gradient(circle, rgba(77,255,0,.25), transparent 70%)",
                }}
              />
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 800,
                  letterSpacing: ".16em",
                  color: rr.green,
                }}
              >
                NEXT SHIFT
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  marginTop: 6,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-anton), 'Anton', Impact",
                    fontSize: 44,
                    lineHeight: 0.95,
                    letterSpacing: "-.01em",
                  }}
                >
                  {DAY_LABELS[next.day]} {weekDates[next.day]}
                </span>
              </div>
              <div
                style={{
                  fontFamily: "var(--font-anton), 'Anton', Impact",
                  fontSize: 26,
                  color: rr.green,
                  lineHeight: 1,
                  marginTop: 6,
                }}
              >
                {fmtHour(next.startHour).toUpperCase()} –{" "}
                {fmtHour(next.endHour).toUpperCase()}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "rgba(255,255,255,.75)",
                  marginTop: 6,
                }}
              >
                {roleLabel ?? next.departmentName} · {next.endHour - next.startHour} hr
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    height: 38,
                    border: 0,
                    borderRadius: 8,
                    background: "linear-gradient(180deg,#7AFF40,#4DFF00)",
                    color: rr.navyDark,
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                    boxShadow: "0 2px 0 0 #2E9900",
                  }}
                >
                  Clock in
                </button>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    height: 38,
                    borderRadius: 8,
                    background: "rgba(255,255,255,.08)",
                    border: "1px solid rgba(255,255,255,.18)",
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  Swap
                </button>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
            {DAY_LABELS.map((d, i) => {
              const has = sorted.find((s) => s.day === i)
              const isNext = has && next && has.day === next.day
              return (
                <div
                  key={d}
                  style={{
                    flex: 1,
                    padding: "8px 2px",
                    textAlign: "center",
                    borderRadius: 8,
                    background: isNext
                      ? rr.green
                      : has
                        ? "#fff"
                        : rr.lineSoft,
                    border: `1px solid ${isNext ? rr.green : has ? rr.line : "transparent"}`,
                    color: isNext
                      ? rr.navyDark
                      : has
                        ? rr.navy
                        : rr.greyDark,
                  }}
                >
                  <div
                    style={{
                      fontSize: 8.5,
                      fontWeight: 800,
                      letterSpacing: ".08em",
                    }}
                  >
                    {d}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-anton), 'Anton', Impact",
                      fontSize: 16,
                      lineHeight: 1.1,
                    }}
                  >
                    {weekDates[i]}
                  </div>
                  <div
                    style={{
                      width: 4,
                      height: 4,
                      borderRadius: 9999,
                      margin: "3px auto 0",
                      background: isNext
                        ? rr.navyDark
                        : has
                          ? rr.green
                          : "transparent",
                    }}
                  />
                </div>
              )
            })}
          </div>

          {sorted.length > 0 && (
            <>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: ".16em",
                  color: rr.greyDark,
                  marginBottom: 8,
                }}
              >
                UPCOMING
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {sorted.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      background: "#fff",
                      borderRadius: 12,
                      border: `1px solid ${rr.line}`,
                      padding: 12,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        width: 42,
                        height: 46,
                        borderRadius: 8,
                        background: rr.navy,
                        color: "#fff",
                        display: "grid",
                        placeItems: "center",
                        flexShrink: 0,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 8.5,
                          fontWeight: 800,
                          color: rr.green,
                          letterSpacing: ".1em",
                        }}
                      >
                        {DAY_LABELS[s.day]}
                      </div>
                      <div
                        style={{
                          fontFamily:
                            "var(--font-anton), 'Anton', Impact",
                          fontSize: 18,
                          lineHeight: 1,
                        }}
                      >
                        {weekDates[s.day]}
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: rr.navy,
                        }}
                      >
                        {fmtHour(s.startHour)} – {fmtHour(s.endHour)}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: rr.greyDark,
                          marginTop: 1,
                        }}
                      >
                        {s.departmentName}
                      </div>
                    </div>
                    <NavIcon path={ICONS.chev} size={14} />
                  </div>
                ))}
              </div>
            </>
          )}

          {openShifts.length > 0 && (
            <>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: ".16em",
                  color: rr.greyDark,
                  margin: "16px 0 8px",
                }}
              >
                OPEN · PICK UP
              </div>
              {openShifts.slice(0, 2).map((o) => (
                <div
                  key={o.id}
                  style={{
                    background: "rgba(77,255,0,.08)",
                    border: `1px solid ${rr.green}40`,
                    borderRadius: 12,
                    padding: 12,
                    marginBottom: 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      width: 42,
                      height: 46,
                      borderRadius: 8,
                      background: "#fff",
                      border: `1px solid ${hexWithAlpha(o.departmentColor, 0.4)}`,
                      color: o.departmentColor,
                      display: "grid",
                      placeItems: "center",
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 8.5,
                        fontWeight: 800,
                        letterSpacing: ".1em",
                      }}
                    >
                      {DAY_LABELS[o.day]}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-anton), 'Anton', Impact",
                        fontSize: 18,
                        lineHeight: 1,
                      }}
                    >
                      {weekDates[o.day]}
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: rr.navy,
                      }}
                    >
                      {fmtHour(o.startHour)}–{fmtHour(o.endHour)}
                    </div>
                    <div style={{ fontSize: 11, color: rr.greyDark }}>
                      {o.departmentName} · +{o.endHour - o.startHour}h
                    </div>
                  </div>
                  <button
                    type="button"
                    style={{
                      padding: "7px 12px",
                      border: 0,
                      borderRadius: 8,
                      background: rr.green,
                      color: rr.navyDark,
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: ".06em",
                      textTransform: "uppercase",
                      cursor: "pointer",
                      boxShadow: "0 2px 0 0 #2E9900",
                    }}
                  >
                    Claim
                  </button>
                </div>
              ))}
            </>
          )}
        </div>

        <div
          style={{
            height: 56,
            borderTop: `1px solid ${rr.line}`,
            background: "#fff",
            display: "flex",
            justifyContent: "space-around",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          {[
            { i: ICONS.dashboard, l: "Home", on: false },
            { i: ICONS.cal, l: "Shifts", on: true },
            { i: ICONS.msg, l: "Team", on: false },
            { i: ICONS.user, l: "Me", on: false },
          ].map((t) => (
            <div
              key={t.l}
              style={{
                textAlign: "center",
                color: t.on ? rr.navy : rr.greyDark,
              }}
            >
              <NavIcon path={t.i} size={20} />
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: t.on ? 700 : 500,
                  marginTop: 2,
                  letterSpacing: ".04em",
                }}
              >
                {t.l}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function WeekDashboard(props: WeekDashboardProps) {
  const [view, setView] = useState<View>("week")
  const [density, setDensity] = useState<Density>("comfortable")
  const [colorBy, setColorBy] = useState<ColorBy>("role")
  const [heatmap, setHeatmap] = useState(false)
  const [showEmployee, setShowEmployee] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)

  const selectedShift = useMemo(
    () => props.shifts.find((s) => s.id === selected) ?? null,
    [selected, props.shifts]
  )

  const departmentsForLegend = useMemo(() => {
    const seen = new Map<string, { name: string; color: string }>()
    for (const s of props.shifts) {
      if (!seen.has(s.departmentId)) {
        seen.set(s.departmentId, {
          name: s.departmentName,
          color: s.departmentColor,
        })
      }
    }
    return Array.from(seen.values())
  }, [props.shifts])

  return (
    <div
      style={{
        background: pageBg,
        color: textPrimary,
        fontFamily: "var(--font-geist-sans), Inter, system-ui, sans-serif",
        minHeight: "100%",
      }}
    >
      <div
        style={{
          padding: "20px 28px 0",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: ".16em",
              color: rr.greenInk,
              textTransform: "uppercase",
            }}
          >
            {props.weekLabel} · {props.facilityName}
          </div>
          <h1
            style={{
              margin: "6px 0 0",
              fontFamily: "var(--font-anton), 'Anton', Impact",
              fontSize: 38,
              lineHeight: 1,
              color: textPrimary,
              textTransform: "uppercase",
              letterSpacing: "-.01em",
            }}
          >
            Employee Scheduling
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              border: `1px solid ${line}`,
              background: surface,
              color: textPrimary,
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
            }}
          >
            <NavIcon path={ICONS.chevL} size={16} />
          </button>
          <div
            style={{
              padding: "0 14px",
              height: 36,
              borderRadius: 8,
              background: surface,
              border: `1px solid ${line}`,
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: textPrimary,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <NavIcon path={ICONS.cal} size={14} /> {props.weekLabel.split(" · ")[0]}
          </div>
          <button
            type="button"
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              border: `1px solid ${line}`,
              background: surface,
              color: textPrimary,
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
            }}
          >
            <NavIcon path={ICONS.chev} size={16} />
          </button>
          <button
            type="button"
            style={{
              padding: "0 14px",
              height: 36,
              borderRadius: 8,
              border: `1px solid ${line}`,
              background: surface,
              color: textPrimary,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              marginLeft: 4,
            }}
          >
            Today
          </button>

          <div
            style={{
              width: 1,
              height: 28,
              background: line,
              margin: "0 6px",
            }}
          />

          <ViewSwitcher view={view} onView={setView} />

          <div
            style={{
              width: 1,
              height: 28,
              background: line,
              margin: "0 6px",
            }}
          />

          <Link
            href="/admin/scheduling/shifts"
            style={{
              padding: "0 18px",
              height: 38,
              borderRadius: 8,
              border: 0,
              cursor: "pointer",
              background: "linear-gradient(180deg,#0055A3,#003B6F)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: 6,
              boxShadow:
                "0 2px 0 0 #001A3A, 0 4px 8px rgba(0,59,111,.35)",
              textDecoration: "none",
            }}
          >
            <NavIcon path={ICONS.plus} size={14} /> Add shift
          </Link>
          <Link
            href="/admin/scheduling/publish"
            style={{
              padding: "0 18px",
              height: 38,
              borderRadius: 8,
              border: 0,
              cursor: "pointer",
              background: "linear-gradient(180deg,#7AFF40,#4DFF00)",
              color: textPrimary,
              fontSize: 13,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              gap: 6,
              letterSpacing: ".04em",
              textTransform: "uppercase",
              boxShadow: "0 2px 0 0 #2E9900, 0 4px 8px rgba(77,255,0,.30)",
              textDecoration: "none",
            }}
          >
            <NavIcon path={ICONS.pub} size={14} /> Publish
          </Link>
        </div>
      </div>

      <div style={{ padding: "20px 28px 28px" }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
          <Kpi
            label="Scheduled hrs"
            value={props.totalScheduledHours}
            sub={props.weekLabel}
            accent={textPrimary}
            icon={<NavIcon path={ICONS.cal} size={18} />}
          />
          <Kpi
            label="Shifts"
            value={props.shifts.length}
            sub={`${props.crew.length} employees`}
            accent={textPrimary}
            icon={<NavIcon path={ICONS.user} size={18} />}
          />
          <Kpi
            label="Labor cost"
            value={`$${props.laborCostEstimate.toLocaleString()}`}
            sub="Est · avg $26/hr"
            accent={rr.greenInk}
            icon={
              <span
                style={{
                  fontFamily: "var(--font-anton), 'Anton', Impact",
                  fontSize: 18,
                }}
              >
                $
              </span>
            }
          />
          <Kpi
            label="Open shifts"
            value={props.openShifts.length}
            sub="Need coverage"
            accent={rr.yellowDark}
            icon={<NavIcon path={ICONS.alert} size={18} />}
          />
          <Kpi
            label="Swap requests"
            value={
              props.swaps.filter((s) => s.status === "pending").length
            }
            sub="Awaiting approval"
            accent={rr.red}
            icon={<NavIcon path={ICONS.arrow} size={18} />}
          />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 14,
            flexWrap: "wrap",
          }}
        >
          <ColorBySwitcher value={colorBy} onChange={setColorBy} />
          <ToolbarToggle
            on={heatmap}
            onClick={() => setHeatmap(!heatmap)}
            icon={<NavIcon path={ICONS.sliders} size={14} />}
          >
            Coverage heatmap
          </ToolbarToggle>
          <div
            style={{
              display: "flex",
              gap: 3,
              background: surface,
              border: `1px solid ${line}`,
              borderRadius: 9,
              padding: 3,
            }}
          >
            {(["compact", "comfortable", "spacious"] as Density[]).map(
              (d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDensity(d)}
                  style={{
                    padding: "7px 10px",
                    fontSize: 11,
                    fontWeight: 600,
                    border: 0,
                    borderRadius: 6,
                    background:
                      density === d ? subtleBg : "transparent",
                    color: density === d ? textPrimary : textMuted,
                    cursor: "pointer",
                    textTransform: "capitalize",
                  }}
                >
                  {d}
                </button>
              )
            )}
          </div>
          <ToolbarToggle
            on={showEmployee}
            onClick={() => setShowEmployee(!showEmployee)}
            icon={<NavIcon path={ICONS.user} size={14} />}
          >
            Employee preview
          </ToolbarToggle>
          <div style={{ flex: 1 }} />
          <LegendRoles colorBy={colorBy} departments={departmentsForLegend} />
          <button
            type="button"
            style={{
              height: 36,
              padding: "0 12px",
              borderRadius: 8,
              border: `1px solid ${line}`,
              background: surface,
              color: textPrimary,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <NavIcon path={ICONS.download} size={14} /> Export
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: showEmployee
              ? "minmax(0,1fr) 340px 340px"
              : "minmax(0,1fr) 340px",
            gap: 16,
            alignItems: "start",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <WeekGrid
              density={density}
              colorBy={colorBy}
              showHeatmap={heatmap}
              todayIndex={props.todayIndex}
              nowFractionalHour={props.nowFractionalHour}
              weekDates={props.weekDates}
              shifts={props.shifts}
              selected={selected}
              onSelect={(id) =>
                setSelected((prev) => (prev === id ? null : id))
              }
            />
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: 14 }}
          >
            {selectedShift ? (
              <ShiftDetail
                shift={selectedShift}
                weekDates={props.weekDates}
                onClose={() => setSelected(null)}
              />
            ) : (
              <OpenShiftsPanel
                openShifts={props.openShifts}
                weekDates={props.weekDates}
              />
            )}
            <SwapsPanel swaps={props.swaps} weekDates={props.weekDates} />
            <TimeOffPanel timeOff={props.timeOff} />
            <CrewRosterPanel crew={props.crew} />
          </div>
          {showEmployee && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                alignItems: "center",
                position: "sticky",
                top: 20,
              }}
            >
              <div style={{ width: "100%", textAlign: "center" }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: ".16em",
                    color: rr.greenInk,
                    textTransform: "uppercase",
                  }}
                >
                  Employee view
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-anton), 'Anton', Impact",
                    fontSize: 16,
                    color: textPrimary,
                    textTransform: "uppercase",
                    marginTop: 2,
                  }}
                >
                  {props.employeeViewName
                    ? `What ${props.employeeViewName.split(" ")[0]} sees`
                    : "Employee app"}
                </div>
              </div>
              <EmployeePhone
                employeeName={props.employeeViewName}
                hue={props.employeeViewHue}
                roleLabel={props.employeeViewRoleLabel}
                shifts={props.employeeViewShifts}
                weekDates={props.weekDates}
                openShifts={props.openShifts}
                todayIndex={props.todayIndex}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
