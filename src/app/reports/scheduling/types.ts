import type { Tables } from "@/types/database"

export type ScheduleShift = Tables<"schedule_shifts">
export type ScheduleOpenShift = Tables<"schedule_open_shifts">
export type ScheduleTimeOffRequest = Tables<"schedule_time_off_requests">
export type ScheduleAvailability = Tables<"schedule_availability">
export type ScheduleSwapRequest = Tables<"schedule_swap_requests">
export type ScheduleNotification = Tables<"schedule_notifications">
export type ScheduleSettings = Tables<"schedule_settings">

export type ShiftStatus = "draft" | "published" | "cancelled"
export type TimeOffStatus = "pending" | "approved" | "denied" | "cancelled"
export type SwapStatus =
  | "pending"
  | "accepted"
  | "manager_approved"
  | "applied"
  | "cancelled"
  | "denied"
  | "expired"
export type AvailabilityType = "available" | "unavailable" | "preferred"

export type ActionState =
  | { status: "idle" }
  | { status: "success"; message?: string }
  | { status: "error"; error: string }

export const INITIAL_ACTION_STATE: ActionState = { status: "idle" }

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const

export const SHORT_DAY_NAMES = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const

// A job area / department the employee can choose to work (from
// employee_job_areas, filtered to the employee's assignments).
export type JobAreaOption = { id: string; name: string }

// ---------------------------------------------------------------------------
// Work-week date helpers (pure, local-time, no TZ libraries). Availability is
// stored per day_of_week (recurring weekly); the week grid lays those onto the
// actual calendar dates of the selected week.
// ---------------------------------------------------------------------------

/** "YYYY-MM-DD" for a local Date (the canonical day-detail route param). */
export function toDateParam(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** Parse "YYYY-MM-DD" into a local Date at midnight, or null if invalid. */
export function parseDateParam(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

/** Local midnight of the week containing `d`, given the facility week start. */
export function startOfWeek(d: Date, weekStartDay: number): Date {
  const base = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = (base.getDay() - weekStartDay + 7) % 7
  return addDays(base, -diff)
}

/** The 7 dates of the week starting at `weekStart`. */
export function weekDates(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
}
