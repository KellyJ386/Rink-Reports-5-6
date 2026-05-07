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
