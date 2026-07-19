// Shared client-side model for the scheduling week board: the in-memory event
// shape, the DTO→event mapper, and the deterministic color system used by the
// grid, legend, and crew roster. Pure TS (types + helpers) — safe to import from
// any "use client" component without pulling server-only code.

import type { GridShiftDTO } from "../../_lib/grid-actions"
import type { EmployeeLite } from "../../_lib/types"

export type GridEvent = {
  id: string
  start: Date
  end: Date
  employeeId: string | null
  jobAreaId: string | null
  departmentId: string | null
  status: GridShiftDTO["status"]
  breakMinutes: number
  roleLabel: string | null
  notes: string | null
  /** Series link: null for standalone shifts and series parents. */
  recurringParentId: string | null
}

export function dtoToEvent(dto: GridShiftDTO): GridEvent {
  return {
    id: dto.id,
    start: new Date(dto.starts_at),
    end: new Date(dto.ends_at),
    employeeId: dto.employee_id,
    jobAreaId: dto.job_area_id,
    departmentId: dto.department_id,
    status: dto.status,
    breakMinutes: dto.break_minutes,
    roleLabel: dto.role_label,
    notes: dto.notes,
    recurringParentId: dto.recurring_parent_id,
  }
}

function addLocalDays(d: Date, days: number): Date {
  const next = new Date(d)
  next.setDate(d.getDate() + days)
  next.setHours(0, 0, 0, 0)
  return next
}

/**
 * The month view's visible range (local time): whole weeks from the week
 * containing the 1st of the anchor's month through the week containing its
 * last day — including the dimmed leading/trailing days of adjacent months.
 * `end` is exclusive. Shared by MonthGrid (which renders exactly these days)
 * and the board's KPI/export window so month-view numbers match the calendar.
 */
export function monthGridRange(
  anchor: Date,
  weekStartDay: number
): { start: Date; end: Date; dayCount: number } {
  const wsd = ((weekStartDay % 7) + 7) % 7
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const leading = (firstOfMonth.getDay() - wsd + 7) % 7
  const start = addLocalDays(firstOfMonth, -leading)
  const lastOfMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
  const trailing = (wsd + 6 - lastOfMonth.getDay() + 7) % 7
  const lastDay = addLocalDays(lastOfMonth, trailing)
  const dayCount =
    Math.round((lastDay.getTime() - start.getTime()) / 86_400_000) + 1
  return { start, end: addLocalDays(start, dayCount), dayCount }
}

export function initialsFor(emp: EmployeeLite | undefined | null): string {
  if (!emp) return "—"
  const a = emp.first_name?.[0] ?? ""
  const b = emp.last_name?.[0] ?? ""
  return `${a}${b}`.toUpperCase() || "—"
}

export type ColorBy = "jobArea" | "person"
export type Density = "compact" | "comfortable" | "spacious"
export type BoardView = "day" | "week" | "month"

export type BlockColor = { edge: string; bg: string; border: string }

/**
 * Fixed category palette (raw ramp CSS vars, constant across light/dark just
 * like the module-accent tokens). Used as the per-job-area accent. Block fills
 * are derived via color-mix against `--card` so they adapt to the active theme.
 */
const CATEGORY_VARS = [
  "--navy-500",
  "--violet-500",
  "--green-600",
  "--sky-500",
  "--coral-500",
  "--amber-500",
  "--crimson-500",
  "--module-comms",
] as const

/** Stable small hash of an id string → non-negative integer. */
function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

/** Per-person hue (0–360) mirroring the mock's oklch-by-person coloring. */
export function personHue(id: string): number {
  return hashId(id) % 360
}

function colorFromEdge(edge: string): BlockColor {
  return {
    edge,
    bg: `color-mix(in oklab, ${edge} 16%, var(--card))`,
    border: `color-mix(in oklab, ${edge} 42%, var(--card))`,
  }
}

const OPEN_EDGE = "var(--ice-500)"

/**
 * Resolve a shift block's accent. `jobAreaOrder` maps a job-area id to a stable
 * palette index so colors stay consistent as shifts move around.
 */
export function shiftColor(
  ev: GridEvent,
  colorBy: ColorBy,
  jobAreaOrder: Map<string, number>,
): BlockColor {
  if (colorBy === "person") {
    if (!ev.employeeId) return colorFromEdge(OPEN_EDGE)
    return colorFromEdge(`oklch(0.62 0.19 ${personHue(ev.employeeId)})`)
  }
  if (!ev.jobAreaId) return colorFromEdge(OPEN_EDGE)
  const idx = jobAreaOrder.get(ev.jobAreaId) ?? hashId(ev.jobAreaId)
  return colorFromEdge(`var(${CATEGORY_VARS[idx % CATEGORY_VARS.length]})`)
}

/** Avatar background for a person (matches the per-person grid hue). */
export function personColor(id: string): string {
  return `oklch(0.6 0.18 ${personHue(id)})`
}
