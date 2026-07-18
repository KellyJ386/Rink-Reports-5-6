// Server-only core for daily-report area assignment & routing (Phase 3).
// Shared by the staff-facing actions (My Areas Today) and the
// supervisor/admin assignment actions. Pure set/date logic lives in
// assignment-compute.ts (unit-tested); this module adds the Supabase I/O.
//
// Authorization model (defense in depth, mirrors the RLS in migration 183):
//   * assignment WRITES require the daily_reports `edit` or `admin` action —
//     checked here via currentUserCan AND enforced again by RLS.
//   * reads ride the caller's RLS (module view).
// Scheduling is READ-ONLY territory: nothing in this module writes any
// scheduling table; schedule-derived rows come from the SECURITY DEFINER
// resolve_daily_area_assignments() function (published shifts only).

import "server-only"

import { requireUser } from "@/lib/auth"
import { currentUserCan } from "@/lib/permissions/check"
import { createClient } from "@/lib/supabase/server"

import {
  diffAssignees,
  isDateWithinAssignmentWindow,
  summarizeAreaCompletion,
  type AreaCompletion,
} from "./assignment-compute"
import { businessDateInTimeZone } from "./compute"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

export type AssignmentContext = {
  supabase: SupabaseClient
  userId: string
  employeeId: string
  facilityId: string
  timezone: string | null
  /** Facility-local business date for "now" (YYYY-MM-DD). */
  today: string
  /** daily_reports `edit` or `admin` — may manage assignments. */
  canRoute: boolean
}

export type ContextResult =
  | { ok: true; ctx: AssignmentContext }
  | { ok: false; error: string }

export async function getAssignmentContext(): Promise<ContextResult> {
  const current = await requireUser()
  const supabase = await createClient()

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()
  if (!employeeRow) {
    return { ok: false, error: "Your account isn't fully set up yet." }
  }

  const [{ data: facility }, canEdit, canAdmin] = await Promise.all([
    supabase
      .from("facilities")
      .select("timezone")
      .eq("id", employeeRow.facility_id)
      .maybeSingle(),
    currentUserCan(supabase, "daily_reports", "edit"),
    currentUserCan(supabase, "daily_reports", "admin"),
  ])

  const timezone = facility?.timezone ?? null
  return {
    ok: true,
    ctx: {
      supabase,
      userId: current.authUser.id,
      employeeId: employeeRow.id,
      facilityId: employeeRow.facility_id,
      timezone,
      today: businessDateInTimeZone(new Date(), timezone),
      canRoute: canEdit || canAdmin,
    },
  }
}

export type RoutingSettings = {
  enabled: boolean
  prelockWarningMinutes: number
}

export async function getRoutingSettings(
  supabase: SupabaseClient,
  facilityId: string,
): Promise<RoutingSettings> {
  const { data } = await supabase
    .from("daily_report_settings")
    .select("assignment_routing_enabled, prelock_warning_minutes")
    .eq("facility_id", facilityId)
    .maybeSingle()
  // No row = routing off (pre-feature behavior), threshold at its default.
  return {
    enabled: data?.assignment_routing_enabled ?? false,
    prelockWarningMinutes: data?.prelock_warning_minutes ?? 60,
  }
}

/** Best-effort materialization; a failure must never block rendering. */
async function resolveForDate(
  supabase: SupabaseClient,
  date: string,
): Promise<void> {
  await supabase.rpc("resolve_daily_area_assignments", { p_date: date })
}

type ActiveAssignment = {
  id: string
  area_id: string
  employee_id: string
  source: string
}

async function fetchActiveAssignments(
  supabase: SupabaseClient,
  facilityId: string,
  date: string,
): Promise<ActiveAssignment[]> {
  const { data } = await supabase
    .from("report_area_assignments")
    .select("id, area_id, employee_id, source")
    .eq("facility_id", facilityId)
    .eq("report_date", date)
    .is("superseded_at", null)
  return data ?? []
}

async function fetchEmployeeNames(
  supabase: SupabaseClient,
  employeeIds: string[],
): Promise<Map<string, string>> {
  if (employeeIds.length === 0) return new Map()
  const { data } = await supabase
    .from("employees")
    .select("id, first_name, last_name")
    .in("id", employeeIds)
  return new Map(
    (data ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`.trim()]),
  )
}

/** Distinct submitted template ids per area for the given business date. */
async function fetchSubmittedTemplatesByArea(
  supabase: SupabaseClient,
  facilityId: string,
  date: string,
  areaIds: string[],
): Promise<Map<string, string[]>> {
  if (areaIds.length === 0) return new Map()
  const { data } = await supabase
    .from("daily_report_submissions")
    .select("area_id, template_id")
    .eq("facility_id", facilityId)
    .eq("business_date", date)
    .in("area_id", areaIds)
  const byArea = new Map<string, string[]>()
  for (const row of data ?? []) {
    const list = byArea.get(row.area_id) ?? []
    list.push(row.template_id)
    byArea.set(row.area_id, list)
  }
  return byArea
}

async function fetchTemplateIdsByArea(
  supabase: SupabaseClient,
  facilityId: string,
  areaIds: string[],
): Promise<Map<string, string[]>> {
  if (areaIds.length === 0) return new Map()
  const { data } = await supabase
    .from("daily_report_templates")
    .select("id, area_id")
    .eq("facility_id", facilityId)
    .eq("is_active", true)
    .in("area_id", areaIds)
  const byArea = new Map<string, string[]>()
  for (const row of data ?? []) {
    const list = byArea.get(row.area_id) ?? []
    list.push(row.id)
    byArea.set(row.area_id, list)
  }
  return byArea
}

// ─── Assignment writes (edit/admin tier) ─────────────────────────────────────

export type SimpleResult = { ok: true } | { ok: false; error: string }
export type MutateResult =
  | { ok: true; added: number; removed: number }
  | { ok: false; error: string }

export type AssignmentMode = "add" | "replace" | "clear"

const EDITOR_DENIED =
  "Managing area assignments requires the daily reports edit or admin permission."

/**
 * Single write path for assign ("add"), reassign ("replace") and unassign
 * ("clear"). Supersede-don't-delete: removed assignees get superseded_at
 * stamped; history rows are never deleted. Notifications are inserted for the
 * actual delta only, so repeated saves don't spam.
 */
export async function applyAreaAssignment(
  mode: AssignmentMode,
  input: { areaId: string; date: string; employeeIds: string[] },
): Promise<MutateResult> {
  const context = await getAssignmentContext()
  if (!context.ok) return { ok: false, error: context.error }
  const { ctx } = context
  const { supabase, facilityId } = ctx

  if (!ctx.canRoute) return { ok: false, error: EDITOR_DENIED }
  if (!isDateWithinAssignmentWindow(input.date, ctx.today)) {
    return { ok: false, error: "Assignments can only be changed for the current few days." }
  }

  // Area must be an active area of the caller's facility.
  const { data: area } = await supabase
    .from("daily_report_areas")
    .select("id, name, is_active")
    .eq("id", input.areaId)
    .eq("facility_id", facilityId)
    .maybeSingle()
  if (!area || !area.is_active) return { ok: false, error: "Area not available." }

  const active = (
    await fetchActiveAssignments(supabase, facilityId, input.date)
  ).filter((a) => a.area_id === input.areaId)
  const currentIds = active.map((a) => a.employee_id)

  const nextIds =
    mode === "clear" ? [] : mode === "add"
      ? [...new Set([...currentIds, ...input.employeeIds])]
      : input.employeeIds
  const { toAdd, toRemove } = diffAssignees(currentIds, nextIds)
  if (toAdd.length === 0 && toRemove.length === 0) {
    return { ok: true, added: 0, removed: 0 }
  }

  // New assignees must be active employees of this facility.
  if (toAdd.length > 0) {
    const { data: emps } = await supabase
      .from("employees")
      .select("id")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .in("id", toAdd)
    if ((emps ?? []).length !== toAdd.length) {
      return { ok: false, error: "One or more employees are not active members of your facility." }
    }
  }

  if (toRemove.length > 0) {
    const ids = active
      .filter((a) => toRemove.includes(a.employee_id))
      .map((a) => a.id)
    const { error } = await supabase
      .from("report_area_assignments")
      .update({ superseded_at: new Date().toISOString() })
      .in("id", ids)
    if (error) return { ok: false, error: error.message }
  }

  if (toAdd.length > 0) {
    const { error } = await supabase.from("report_area_assignments").insert(
      toAdd.map((employeeId) => ({
        facility_id: facilityId,
        report_date: input.date,
        area_id: input.areaId,
        employee_id: employeeId,
        source: "manual",
        assigned_by: ctx.employeeId,
      })),
    )
    if (error) return { ok: false, error: error.message }
  }

  // In-app notifications for the delta (best-effort; never fail the write).
  const notif = [
    ...toAdd.map((employeeId) => ({ employeeId, type: "assigned" as const })),
    ...toRemove.map((employeeId) => ({ employeeId, type: "unassigned" as const })),
  ]
  if (notif.length > 0) {
    await supabase.from("daily_report_assignment_notifications").insert(
      notif.map((n) => ({
        facility_id: facilityId,
        employee_id: n.employeeId,
        area_id: input.areaId,
        report_date: input.date,
        notification_type: n.type,
        payload: {
          area_name: area.name,
          source: "manual",
          report_date: input.date,
        },
      })),
    )
  }

  return { ok: true, added: toAdd.length, removed: toRemove.length }
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export type AreaAssignee = {
  employeeId: string
  name: string
  source: string
}

export type AreaTodayStatus = AreaCompletion & {
  id: string
  slug: string
  name: string
  color: string | null
  assignedToMe: boolean
  assignees: AreaAssignee[]
}

export type MyAreasToday = {
  date: string
  routingEnabled: boolean
  /** Areas actively assigned to the caller today (submittable ones). */
  myAreas: AreaTodayStatus[]
  /** Unassigned-today areas the caller may also complete (D4). */
  openAreas: AreaTodayStatus[]
}

/**
 * The staff landing model (D7). Triggers materialization (best-effort), then
 * partitions the caller's submittable areas into assigned-to-me vs open.
 * Areas assigned to somebody else are omitted entirely (D10) — RLS would
 * block their tabs anyway. With routing off every submittable area is open,
 * which is exactly the pre-feature behavior.
 */
export async function getMyAreasToday(): Promise<
  { ok: true; data: MyAreasToday } | { ok: false; error: string }
> {
  const context = await getAssignmentContext()
  if (!context.ok) return { ok: false, error: context.error }
  const { ctx } = context
  const { supabase, facilityId, today } = ctx

  const settings = await getRoutingSettings(supabase, facilityId)
  if (settings.enabled) await resolveForDate(supabase, today)

  // Submittable areas per the standing per-area layer (mirrors
  // getAllowedDailyAreas in ../actions.ts, inlined to avoid an action import).
  const [{ data: areas }, { data: perms }] = await Promise.all([
    supabase
      .from("daily_report_areas")
      .select("id, slug, name, color, sort_order")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("module_area_permissions")
      .select("area_id, can_submit")
      .eq("module_key", "daily_reports")
      .eq("employee_id", ctx.employeeId),
  ])
  const permRows = perms ?? []
  // "No explicit rows = full access" (matches has_area_submit_access).
  const submittable =
    permRows.length === 0
      ? new Set((areas ?? []).map((a) => a.id))
      : new Set(permRows.filter((p) => p.can_submit).map((p) => p.area_id))
  const allowed = (areas ?? []).filter((a) => submittable.has(a.id))
  const allowedIds = allowed.map((a) => a.id)

  const [assignments, templatesByArea, submittedByArea] = await Promise.all([
    settings.enabled
      ? fetchActiveAssignments(supabase, facilityId, today)
      : Promise.resolve([] as ActiveAssignment[]),
    fetchTemplateIdsByArea(supabase, facilityId, allowedIds),
    fetchSubmittedTemplatesByArea(supabase, facilityId, today, allowedIds),
  ])

  const assigneesByArea = new Map<string, ActiveAssignment[]>()
  for (const a of assignments) {
    const list = assigneesByArea.get(a.area_id) ?? []
    list.push(a)
    assigneesByArea.set(a.area_id, list)
  }
  const names = await fetchEmployeeNames(supabase, [
    ...new Set(assignments.map((a) => a.employee_id)),
  ])

  const toStatus = (a: (typeof allowed)[number]): AreaTodayStatus => {
    const rows = assigneesByArea.get(a.id) ?? []
    return {
      id: a.id,
      slug: a.slug,
      name: a.name,
      color: a.color,
      assignedToMe: rows.some((r) => r.employee_id === ctx.employeeId),
      assignees: rows.map((r) => ({
        employeeId: r.employee_id,
        name: names.get(r.employee_id) ?? "Teammate",
        source: r.source,
      })),
      ...summarizeAreaCompletion(
        templatesByArea.get(a.id) ?? [],
        submittedByArea.get(a.id) ?? [],
      ),
    }
  }

  const statuses = allowed.map(toStatus)
  return {
    ok: true,
    data: {
      date: today,
      routingEnabled: settings.enabled,
      myAreas: statuses.filter((s) => s.assignedToMe),
      openAreas: statuses.filter(
        (s) => !s.assignedToMe && s.assignees.length === 0,
      ),
    },
  }
}

export type AssignmentBoardRow = AreaCompletion & {
  id: string
  slug: string
  name: string
  color: string | null
  assignees: AreaAssignee[]
}

export type AssignmentBoard = {
  date: string
  routingEnabled: boolean
  prelockWarningMinutes: number
  areas: AssignmentBoardRow[]
  /** Active facility employees for the assignee picker. */
  employees: { id: string; name: string }[]
}

/**
 * Supervisor/admin view (Phase 4's pre-lock warning + assignment UI): every
 * active area with its active assignees and completion state for the date.
 */
export async function getAssignmentBoard(
  date?: string,
): Promise<{ ok: true; data: AssignmentBoard } | { ok: false; error: string }> {
  const context = await getAssignmentContext()
  if (!context.ok) return { ok: false, error: context.error }
  const { ctx } = context
  if (!ctx.canRoute) return { ok: false, error: EDITOR_DENIED }
  const { supabase, facilityId } = ctx

  const boardDate = date ?? ctx.today
  if (!isDateWithinAssignmentWindow(boardDate, ctx.today)) {
    return { ok: false, error: "Date out of range." }
  }

  const settings = await getRoutingSettings(supabase, facilityId)
  if (settings.enabled) await resolveForDate(supabase, boardDate)

  const { data: areas } = await supabase
    .from("daily_report_areas")
    .select("id, slug, name, color, sort_order")
    .eq("facility_id", facilityId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
  const areaIds = (areas ?? []).map((a) => a.id)

  const [assignments, templatesByArea, submittedByArea, { data: emps }] =
    await Promise.all([
      fetchActiveAssignments(supabase, facilityId, boardDate),
      fetchTemplateIdsByArea(supabase, facilityId, areaIds),
      fetchSubmittedTemplatesByArea(supabase, facilityId, boardDate, areaIds),
      supabase
        .from("employees")
        .select("id, first_name, last_name")
        .eq("facility_id", facilityId)
        .eq("is_active", true)
        .order("first_name", { ascending: true }),
    ])

  const names = new Map(
    (emps ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`.trim()]),
  )
  const assigneesByArea = new Map<string, ActiveAssignment[]>()
  for (const a of assignments) {
    const list = assigneesByArea.get(a.area_id) ?? []
    list.push(a)
    assigneesByArea.set(a.area_id, list)
  }

  return {
    ok: true,
    data: {
      date: boardDate,
      routingEnabled: settings.enabled,
      prelockWarningMinutes: settings.prelockWarningMinutes,
      areas: (areas ?? []).map((a) => ({
        id: a.id,
        slug: a.slug,
        name: a.name,
        color: a.color,
        assignees: (assigneesByArea.get(a.id) ?? []).map((r) => ({
          employeeId: r.employee_id,
          name: names.get(r.employee_id) ?? "Unknown",
          source: r.source,
        })),
        ...summarizeAreaCompletion(
          templatesByArea.get(a.id) ?? [],
          submittedByArea.get(a.id) ?? [],
        ),
      })),
      employees: (emps ?? []).map((e) => ({
        id: e.id,
        name: `${e.first_name} ${e.last_name}`.trim(),
      })),
    },
  }
}

// ─── Notifications ───────────────────────────────────────────────────────────

export type AssignmentNotification = {
  id: string
  areaId: string
  reportDate: string
  type: "assigned" | "unassigned"
  areaName: string | null
  readAt: string | null
  createdAt: string
}

export async function getMyAssignmentNotifications(limit = 20): Promise<{
  notifications: AssignmentNotification[]
  unreadCount: number
}> {
  const context = await getAssignmentContext()
  if (!context.ok) return { notifications: [], unreadCount: 0 }
  const { supabase, employeeId } = context.ctx

  const [{ data: rows }, { count }] = await Promise.all([
    supabase
      .from("daily_report_assignment_notifications")
      .select("id, area_id, report_date, notification_type, payload, read_at, created_at")
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("daily_report_assignment_notifications")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", employeeId)
      .is("read_at", null),
  ])

  return {
    notifications: (rows ?? []).map((r) => ({
      id: r.id,
      areaId: r.area_id,
      reportDate: r.report_date,
      type: r.notification_type as "assigned" | "unassigned",
      areaName:
        typeof (r.payload as Record<string, unknown> | null)?.["area_name"] ===
        "string"
          ? ((r.payload as Record<string, unknown>)["area_name"] as string)
          : null,
      readAt: r.read_at,
      createdAt: r.created_at,
    })),
    unreadCount: count ?? 0,
  }
}

export async function markAssignmentNotificationsRead(
  ids: string[] | "all",
): Promise<SimpleResult> {
  const context = await getAssignmentContext()
  if (!context.ok) return { ok: false, error: context.error }
  const { supabase, employeeId } = context.ctx

  let query = supabase
    .from("daily_report_assignment_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("employee_id", employeeId)
    .is("read_at", null)
  if (ids !== "all") {
    if (ids.length === 0) return { ok: true }
    query = query.in("id", ids)
  }
  const { error } = await query
  return error ? { ok: false, error: error.message } : { ok: true }
}
