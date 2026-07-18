"use server"

// Server actions for daily-report area assignment & routing (Phase 3).
// Thin zod-validated wrappers over _lib/assignments.ts; the write path is
// double-gated (currentUserCan edit/admin here + RLS in migration 183).
// Consumed by the Phase 4 UI (My Areas Today, supervisor board, admin config).

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { logServerError } from "@/lib/observability/log-server-error"

import {
  applyAreaAssignment,
  getAssignmentBoard,
  getMyAreasToday,
  getMyAssignmentNotifications,
  markAssignmentNotificationsRead,
  type AssignmentBoard,
  type AssignmentNotification,
  type MyAreasToday,
  type MutateResult,
  type SimpleResult,
} from "./_lib/assignments"

export type {
  AssignmentBoard,
  AssignmentNotification,
  MyAreasToday,
} from "./_lib/assignments"

const mutateSchema = z.object({
  areaId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  employeeIds: z.array(z.string().uuid()).max(50),
})

const clearSchema = mutateSchema.omit({ employeeIds: true })

function invalid(): { ok: false; error: string } {
  return { ok: false, error: "Invalid input." }
}

/** Add assignees to an area for a date (keeps existing assignees). */
export async function assignArea(input: unknown): Promise<MutateResult> {
  try {
    const parsed = mutateSchema.safeParse(input)
    if (!parsed.success) return invalid()
    const result = await applyAreaAssignment("add", parsed.data)
    if (result.ok) revalidatePath("/reports/daily")
    return result
  } catch (e) {
    logServerError("reports/daily/assignment-actions#assignArea", e)
    return { ok: false, error: "Failed to assign area." }
  }
}

/** Replace the area's assignees for a date (sick-day one-step swap). */
export async function reassignArea(input: unknown): Promise<MutateResult> {
  try {
    const parsed = mutateSchema.safeParse(input)
    if (!parsed.success) return invalid()
    const result = await applyAreaAssignment("replace", parsed.data)
    if (result.ok) revalidatePath("/reports/daily")
    return result
  } catch (e) {
    logServerError("reports/daily/assignment-actions#reassignArea", e)
    return { ok: false, error: "Failed to reassign area." }
  }
}

/**
 * Remove all assignees: the area reverts to OPEN for that date (D4) and the
 * resolution engine will not re-materialize over it (rows remain as history).
 */
export async function unassignArea(input: unknown): Promise<MutateResult> {
  try {
    const parsed = clearSchema.safeParse(input)
    if (!parsed.success) return invalid()
    const result = await applyAreaAssignment("clear", {
      ...parsed.data,
      employeeIds: [],
    })
    if (result.ok) revalidatePath("/reports/daily")
    return result
  } catch (e) {
    logServerError("reports/daily/assignment-actions#unassignArea", e)
    return { ok: false, error: "Failed to unassign area." }
  }
}

/** Staff landing model: my assigned areas + open areas for today (D7). */
export async function getMyAreasTodayAction(): Promise<
  { ok: true; data: MyAreasToday } | { ok: false; error: string }
> {
  try {
    return await getMyAreasToday()
  } catch (e) {
    logServerError("reports/daily/assignment-actions#getMyAreasToday", e)
    return { ok: false, error: "Failed to load your areas." }
  }
}

/** Supervisor/admin board for a date (assignees + completion, D5 view). */
export async function getAssignmentBoardAction(
  date?: string,
): Promise<{ ok: true; data: AssignmentBoard } | { ok: false; error: string }> {
  try {
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return invalid()
    return await getAssignmentBoard(date)
  } catch (e) {
    logServerError("reports/daily/assignment-actions#getAssignmentBoard", e)
    return { ok: false, error: "Failed to load the assignment board." }
  }
}

export async function getMyAssignmentNotificationsAction(): Promise<{
  notifications: AssignmentNotification[]
  unreadCount: number
}> {
  try {
    return await getMyAssignmentNotifications()
  } catch (e) {
    logServerError("reports/daily/assignment-actions#getNotifications", e)
    return { notifications: [], unreadCount: 0 }
  }
}

export async function markAssignmentNotificationsReadAction(
  input: unknown,
): Promise<SimpleResult> {
  try {
    const parsed = z
      .union([z.literal("all"), z.array(z.string().uuid()).max(100)])
      .safeParse(input)
    if (!parsed.success) return invalid()
    const result = await markAssignmentNotificationsRead(parsed.data)
    if (result.ok) revalidatePath("/reports/daily")
    return result
  } catch (e) {
    logServerError("reports/daily/assignment-actions#markNotificationsRead", e)
    return { ok: false, error: "Failed to update notifications." }
  }
}
