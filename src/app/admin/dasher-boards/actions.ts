"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"
import { logServerError } from "@/lib/observability/log-server-error"
import { dbError } from "@/lib/db-error"

import {
  isCadence,
  isUuid,
  nextLabel,
  isAssetType,
} from "@/app/reports/dasher-boards/_lib/compute"
import type { Json } from "@/types/database"
import type {
  ActionState,
  GlassSpecInput,
  SimpleResult,
} from "./types"
import {
  isGlassMaterial,
  isPerimeterDirection,
  isRinkTemplate,
} from "./types"

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,15}$/

const ADMIN_PATH = "/admin/dasher-boards"
const REPORTS_PATH = "/reports/dasher-boards"

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
}

function nonEmpty(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function asInt(value: FormDataEntryValue | null): number | null {
  const s = nonEmpty(value)
  if (s === null) return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function asNumber(value: FormDataEntryValue | null): number | null {
  const s = nonEmpty(value)
  if (s === null) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Guard shared by every action in this module (refrigeration pattern):
 * requireAdmin() covers console access, but the dasher_boards RLS write
 * policies gate on has_module_admin_access('dasher_boards') — a module-scoped
 * user_permissions grant requireAdmin does NOT imply. Returns a denial
 * message, or null when allowed.
 */
async function ensureDasherBoardsAdmin(): Promise<string | null> {
  await requireAdmin()
  const supabase = await createClient()
  const allowed = await currentUserCan(supabase, "dasher_boards", "admin")
  return allowed
    ? null
    : "Your account has admin console access but not the Dasher Boards module's admin permission. Ask an administrator to grant it under Admin → Permissions."
}

type AdminCtx =
  | {
      ok: true
      supabase: Awaited<ReturnType<typeof createClient>>
      facilityId: string
      employeeId: string | null
    }
  | { ok: false; error: string }

async function resolveAdminContext(): Promise<AdminCtx> {
  const denied = await ensureDasherBoardsAdmin()
  if (denied) return { ok: false, error: denied }
  const current = await getCurrentUser()
  const profile = current?.profile
  if (!profile) return { ok: false, error: "Not signed in." }
  if (!profile.facility_id) {
    return { ok: false, error: "No facility assigned to your account." }
  }
  const supabase = await createClient()
  // The audit trail records the acting employee when one exists; a pure
  // console account (no employee row) still passes — employee_id is nullable.
  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", profile.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()
  return {
    ok: true,
    supabase,
    facilityId: profile.facility_id,
    employeeId: employeeRow?.id ?? null,
  }
}

function revalidateModule() {
  revalidatePath(ADMIN_PATH)
  revalidatePath(REPORTS_PATH)
}

type EventType =
  | "created"
  | "converted_to_door"
  | "converted_to_board"
  | "relabeled"
  | "deactivated"
  | "reactivated"
  | "glass_toggled"
  | "spec_updated"

async function recordAssetEvents(
  ctx: Extract<AdminCtx, { ok: true }>,
  rows: Array<{ assetId: string; eventType: EventType; detail?: Json }>,
) {
  if (rows.length === 0) return
  const { error } = await ctx.supabase.from("dasher_boards_asset_events").insert(
    rows.map((r) => ({
      facility_id: ctx.facilityId,
      asset_id: r.assetId,
      event_type: r.eventType,
      detail: r.detail ?? null,
      employee_id: ctx.employeeId,
    })),
  )
  // The audit trail is best-effort; a dropped event never fails the mutation
  // but is an ops signal worth surfacing.
  if (error) {
    logServerError("admin/dasher-boards/asset-event-insert", error)
  }
}

async function loadRinkLabels(
  ctx: Extract<AdminCtx, { ok: true }>,
  rinkId: string,
): Promise<{ live: string[]; retired: string[] }> {
  const [{ data: live }, { data: retired }] = await Promise.all([
    ctx.supabase
      .from("dasher_boards_assets")
      .select("label")
      .eq("rink_id", rinkId),
    ctx.supabase
      .from("dasher_boards_retired_labels")
      .select("label")
      .eq("rink_id", rinkId),
  ])
  return {
    live: (live ?? []).map((r) => r.label),
    retired: (retired ?? []).map((r) => r.label),
  }
}

// ============================================================================
// Rinks
// ============================================================================

export async function createRink(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const name = nonEmpty(formData.get("name"))
    if (!name) return { ok: false, error: "Name is required." }
    const slug = nonEmpty(formData.get("slug")) ?? slugify(name)
    if (!SLUG_RE.test(slug)) {
      return {
        ok: false,
        error: "Slug must be lowercase letters, digits, and hyphens.",
      }
    }

    const template = nonEmpty(formData.get("rink_template")) ?? "nhl_200x85"
    if (!isRinkTemplate(template)) {
      return { ok: false, error: "Invalid rink template." }
    }
    const customLength = asNumber(formData.get("custom_length_ft"))
    const customWidth = asNumber(formData.get("custom_width_ft"))
    if (template === "custom" && (!customLength || !customWidth)) {
      return {
        ok: false,
        error: "Custom rinks need a length and width in feet.",
      }
    }

    const direction = nonEmpty(formData.get("perimeter_direction")) ?? "clockwise"
    if (!isPerimeterDirection(direction)) {
      return { ok: false, error: "Invalid perimeter direction." }
    }
    const weekday = asInt(formData.get("inspection_weekday")) ?? 1
    if (weekday < 0 || weekday > 6) {
      return { ok: false, error: "Inspection weekday must be 0 (Sun) – 6 (Sat)." }
    }

    const { error } = await ctx.supabase.from("dasher_boards_rinks").insert({
      facility_id: ctx.facilityId,
      name,
      slug,
      rink_template: template,
      custom_length_ft: template === "custom" ? customLength : null,
      custom_width_ft: template === "custom" ? customWidth : null,
      perimeter_anchor_label: nonEmpty(formData.get("perimeter_anchor_label")),
      perimeter_direction: direction,
      inspection_weekday: weekday,
      sort_order: asInt(formData.get("sort_order")) ?? 0,
      is_default: formData.get("is_default") === "on",
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to create rink.") }
    }
    revalidateModule()
    return { ok: true, message: "Rink created." }
  } catch (e) {
    logServerError("admin/dasher-boards/createRink", e)
    return { ok: false, error: "Failed to create rink." }
  }
}

export async function updateRink(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const id = nonEmpty(formData.get("id"))
    if (!id || !isUuid(id)) return { ok: false, error: "Invalid rink." }

    const name = nonEmpty(formData.get("name"))
    if (!name) return { ok: false, error: "Name is required." }

    const template = nonEmpty(formData.get("rink_template")) ?? "nhl_200x85"
    if (!isRinkTemplate(template)) {
      return { ok: false, error: "Invalid rink template." }
    }
    const customLength = asNumber(formData.get("custom_length_ft"))
    const customWidth = asNumber(formData.get("custom_width_ft"))
    if (template === "custom" && (!customLength || !customWidth)) {
      return { ok: false, error: "Custom rinks need a length and width in feet." }
    }

    const direction = nonEmpty(formData.get("perimeter_direction")) ?? "clockwise"
    if (!isPerimeterDirection(direction)) {
      return { ok: false, error: "Invalid perimeter direction." }
    }
    const weekday = asInt(formData.get("inspection_weekday")) ?? 1
    if (weekday < 0 || weekday > 6) {
      return { ok: false, error: "Inspection weekday must be 0 (Sun) – 6 (Sat)." }
    }

    const { data, error } = await ctx.supabase
      .from("dasher_boards_rinks")
      .update({
        name,
        rink_template: template,
        custom_length_ft: template === "custom" ? customLength : null,
        custom_width_ft: template === "custom" ? customWidth : null,
        perimeter_anchor_label: nonEmpty(formData.get("perimeter_anchor_label")),
        perimeter_direction: direction,
        inspection_weekday: weekday,
        sort_order: asInt(formData.get("sort_order")) ?? 0,
        is_active: formData.get("is_active") !== "off",
      })
      .eq("id", id)
      .eq("facility_id", ctx.facilityId)
      .select("id")
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update rink.") }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Rink not found." }
    }
    revalidateModule()
    return { ok: true, message: "Rink updated." }
  } catch (e) {
    logServerError("admin/dasher-boards/updateRink", e)
    return { ok: false, error: "Failed to update rink." }
  }
}

// ============================================================================
// Perimeter generation & granular editing
// ============================================================================

export async function generatePerimeter(
  rinkId: string,
  positionCount: number,
): Promise<SimpleResult> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return ctx
    if (!isUuid(rinkId)) return { ok: false, error: "Invalid rink." }

    const { data: rink } = await ctx.supabase
      .from("dasher_boards_rinks")
      .select("id, facility_id")
      .eq("id", rinkId)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle()
    if (!rink) return { ok: false, error: "Rink not found." }

    const { error } = await ctx.supabase.rpc("dasher_boards_generate_perimeter", {
      p_rink_id: rinkId,
      p_count: Math.trunc(positionCount),
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to generate the perimeter.") }
    }
    revalidateModule()
    return { ok: true }
  } catch (e) {
    logServerError("admin/dasher-boards/generatePerimeter", e)
    return { ok: false, error: "Failed to generate the perimeter." }
  }
}

/**
 * Marks a board position as a door. The asset ROW (and its issue history)
 * survives; it takes the next available door label per the no-renumbering
 * rule (e.g. B12 becomes D5 — B12 is retired forever, by trigger). The
 * position's 1:1 glass row deactivates: the door carries its own glass spec.
 */
export async function convertAssetToDoor(
  assetId: string,
  subtypeId: string | null,
): Promise<SimpleResult> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return ctx
    if (!isUuid(assetId)) return { ok: false, error: "Invalid asset." }
    if (subtypeId !== null && !isUuid(subtypeId)) {
      return { ok: false, error: "Invalid subtype." }
    }

    const { data: asset } = await ctx.supabase
      .from("dasher_boards_assets")
      .select("id, rink_id, facility_id, asset_type, label, is_active")
      .eq("id", assetId)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle()
    if (!asset) return { ok: false, error: "Asset not found." }
    if (asset.asset_type !== "board_panel") {
      return { ok: false, error: "Only board panels can become doors." }
    }
    if (!asset.is_active) {
      return { ok: false, error: "Reactivate the asset before converting it." }
    }

    if (subtypeId) {
      const { data: subtype } = await ctx.supabase
        .from("dasher_boards_asset_subtypes")
        .select("id, asset_type, is_active")
        .eq("id", subtypeId)
        .eq("facility_id", ctx.facilityId)
        .maybeSingle()
      if (!subtype || subtype.asset_type !== "door" || !subtype.is_active) {
        return { ok: false, error: "Invalid door subtype." }
      }
    }

    const labels = await loadRinkLabels(ctx, asset.rink_id)
    const newLabel = nextLabel("door", labels.live, labels.retired)

    const { error } = await ctx.supabase
      .from("dasher_boards_assets")
      .update({ asset_type: "door", subtype_id: subtypeId, label: newLabel })
      .eq("id", assetId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to convert to a door.") }
    }

    // The door owns its glass now; park the position's separate glass row.
    const { data: glassRows, error: glassErr } = await ctx.supabase
      .from("dasher_boards_assets")
      .update({ is_active: false })
      .eq("parent_board_id", assetId)
      .eq("asset_type", "glass_panel")
      .select("id")
    if (glassErr) {
      logServerError("admin/dasher-boards/convertAssetToDoor:glass", glassErr)
    }

    await recordAssetEvents(ctx, [
      {
        assetId,
        eventType: "converted_to_door",
        detail: { from_label: asset.label, to_label: newLabel, subtype_id: subtypeId },
      },
      ...(glassRows ?? []).map((g) => ({
        assetId: g.id,
        eventType: "deactivated" as EventType,
        detail: { reason: "parent_converted_to_door" },
      })),
    ])
    revalidateModule()
    return { ok: true }
  } catch (e) {
    logServerError("admin/dasher-boards/convertAssetToDoor", e)
    return { ok: false, error: "Failed to convert to a door." }
  }
}

/** Changes an existing door's subtype (post-conversion correction). */
export async function setDoorSubtype(
  assetId: string,
  subtypeId: string | null,
): Promise<SimpleResult> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return ctx
    if (!isUuid(assetId)) return { ok: false, error: "Invalid asset." }
    if (subtypeId !== null && !isUuid(subtypeId)) {
      return { ok: false, error: "Invalid subtype." }
    }
    if (subtypeId) {
      const { data: subtype } = await ctx.supabase
        .from("dasher_boards_asset_subtypes")
        .select("id, asset_type, is_active")
        .eq("id", subtypeId)
        .eq("facility_id", ctx.facilityId)
        .maybeSingle()
      if (!subtype || subtype.asset_type !== "door" || !subtype.is_active) {
        return { ok: false, error: "Invalid door subtype." }
      }
    }
    const { data, error } = await ctx.supabase
      .from("dasher_boards_assets")
      .update({ subtype_id: subtypeId })
      .eq("id", assetId)
      .eq("facility_id", ctx.facilityId)
      .eq("asset_type", "door")
      .select("id")
    if (error) return { ok: false, error: dbError(error, "Failed to set subtype.") }
    if (!data || data.length === 0) return { ok: false, error: "Door not found." }
    revalidateModule()
    return { ok: true }
  } catch (e) {
    logServerError("admin/dasher-boards/setDoorSubtype", e)
    return { ok: false, error: "Failed to set subtype." }
  }
}

/** Sets the weekday (0=Sun..6=Sat) weekly checklist items come due. */
export async function setRinkInspectionWeekday(
  rinkId: string,
  weekday: number,
): Promise<SimpleResult> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return ctx
    if (!isUuid(rinkId)) return { ok: false, error: "Invalid rink." }
    const day = Math.trunc(weekday)
    if (day < 0 || day > 6) {
      return { ok: false, error: "Weekday must be 0 (Sun) – 6 (Sat)." }
    }
    const { data, error } = await ctx.supabase
      .from("dasher_boards_rinks")
      .update({ inspection_weekday: day })
      .eq("id", rinkId)
      .eq("facility_id", ctx.facilityId)
      .select("id")
    if (error) return { ok: false, error: dbError(error, "Failed to set the weekday.") }
    if (!data || data.length === 0) return { ok: false, error: "Rink not found." }
    revalidateModule()
    return { ok: true }
  } catch (e) {
    logServerError("admin/dasher-boards/setRinkInspectionWeekday", e)
    return { ok: false, error: "Failed to set the weekday." }
  }
}

/** Converts a door back to a board panel; restores the position's glass row. */
export async function convertDoorToBoard(assetId: string): Promise<SimpleResult> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return ctx
    if (!isUuid(assetId)) return { ok: false, error: "Invalid asset." }

    const { data: asset } = await ctx.supabase
      .from("dasher_boards_assets")
      .select(
        "id, rink_id, facility_id, asset_type, label, is_active, glass_width_in, glass_height_in, glass_thickness_in, glass_material, spec_notes",
      )
      .eq("id", assetId)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle()
    if (!asset) return { ok: false, error: "Asset not found." }
    if (asset.asset_type !== "door") {
      return { ok: false, error: "Only doors can convert back to boards." }
    }
    if (!asset.is_active) {
      return { ok: false, error: "Reactivate the asset before converting it." }
    }

    const labels = await loadRinkLabels(ctx, asset.rink_id)
    const newLabel = nextLabel("board_panel", labels.live, labels.retired)

    // Boards carry no glass spec (DB check) — the door's spec is preserved in
    // the audit detail should the conversion ever need to be undone by hand.
    const { error } = await ctx.supabase
      .from("dasher_boards_assets")
      .update({
        asset_type: "board_panel",
        subtype_id: null,
        label: newLabel,
        glass_width_in: null,
        glass_height_in: null,
        glass_thickness_in: null,
        glass_material: null,
        spec_notes: null,
      })
      .eq("id", assetId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to convert to a board.") }
    }

    const { data: glassRows, error: glassErr } = await ctx.supabase
      .from("dasher_boards_assets")
      .update({ is_active: true })
      .eq("parent_board_id", assetId)
      .eq("asset_type", "glass_panel")
      .select("id")
    if (glassErr) {
      logServerError("admin/dasher-boards/convertDoorToBoard:glass", glassErr)
    }

    await recordAssetEvents(ctx, [
      {
        assetId,
        eventType: "converted_to_board",
        detail: {
          from_label: asset.label,
          to_label: newLabel,
          door_glass_spec: {
            width_in: asset.glass_width_in,
            height_in: asset.glass_height_in,
            thickness_in: asset.glass_thickness_in,
            material: asset.glass_material,
            notes: asset.spec_notes,
          },
        },
      },
      ...(glassRows ?? []).map((g) => ({
        assetId: g.id,
        eventType: "reactivated" as EventType,
        detail: { reason: "parent_converted_to_board" },
      })),
    ])
    revalidateModule()
    return { ok: true }
  } catch (e) {
    logServerError("admin/dasher-boards/convertDoorToBoard", e)
    return { ok: false, error: "Failed to convert to a board." }
  }
}

/**
 * Inserts a new positioned asset after `afterPosition` (0 = start). Existing
 * assets shift down the sequence but are NEVER relabeled — the new asset takes
 * the next available number for its type.
 */
export async function insertAsset(
  rinkId: string,
  afterPosition: number,
  assetType: "board_panel" | "door",
  subtypeId?: string | null,
): Promise<SimpleResult> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return ctx
    if (!isUuid(rinkId)) return { ok: false, error: "Invalid rink." }
    // Runtime check — server actions are network-reachable and the TS type
    // doesn't survive a forged request.
    if (assetType !== "board_panel" && assetType !== "door") {
      return { ok: false, error: "Insert a board panel or a door." }
    }
    const after = Math.trunc(afterPosition)
    if (after < 0) return { ok: false, error: "Invalid position." }

    const { data: rink } = await ctx.supabase
      .from("dasher_boards_rinks")
      .select("id")
      .eq("id", rinkId)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle()
    if (!rink) return { ok: false, error: "Rink not found." }

    const { error: shiftErr } = await ctx.supabase.rpc(
      "dasher_boards_shift_positions",
      { p_rink_id: rinkId, p_from: after + 1, p_delta: 1 },
    )
    if (shiftErr) {
      return { ok: false, error: dbError(shiftErr, "Failed to open a gap.") }
    }

    const labels = await loadRinkLabels(ctx, rinkId)
    const label = nextLabel(assetType, labels.live, labels.retired)

    const { data: inserted, error } = await ctx.supabase
      .from("dasher_boards_assets")
      .insert({
        facility_id: ctx.facilityId,
        rink_id: rinkId,
        asset_type: assetType,
        subtype_id: assetType === "door" ? (subtypeId ?? null) : null,
        label,
        sequence_position: after + 1,
      })
      .select("id")
      .single()
    if (error || !inserted) {
      // Best-effort: close the gap we just opened so the sequence stays tight.
      await ctx.supabase.rpc("dasher_boards_shift_positions", {
        p_rink_id: rinkId,
        p_from: after + 2,
        p_delta: -1,
      })
      return { ok: false, error: dbError(error, "Failed to insert the asset.") }
    }

    const events: Array<{ assetId: string; eventType: EventType; detail?: Json }> = [
      { assetId: inserted.id, eventType: "created", detail: { label, position: after + 1 } },
    ]

    // New board positions get the 1:1 glass row by default.
    if (assetType === "board_panel") {
      const glassLabel = nextLabel("glass_panel", [...labels.live, label], labels.retired)
      const { data: glass, error: glassErr } = await ctx.supabase
        .from("dasher_boards_assets")
        .insert({
          facility_id: ctx.facilityId,
          rink_id: rinkId,
          asset_type: "glass_panel",
          label: glassLabel,
          parent_board_id: inserted.id,
        })
        .select("id")
        .single()
      if (glassErr) {
        logServerError("admin/dasher-boards/insertAsset:glass", glassErr)
      } else if (glass) {
        events.push({
          assetId: glass.id,
          eventType: "created",
          detail: { label: glassLabel, parent_board_id: inserted.id },
        })
      }
    }

    await recordAssetEvents(ctx, events)
    revalidateModule()
    return { ok: true }
  } catch (e) {
    logServerError("admin/dasher-boards/insertAsset", e)
    return { ok: false, error: "Failed to insert the asset." }
  }
}

/**
 * Removes a positioned asset. With issue history anywhere on the asset (or
 * its glass row): soft-retire — history is preserved, the label stays retired,
 * the position frees up. With zero history ever: hard delete. Either way the
 * sequence gap closes; nothing is relabeled.
 */
export async function removeAsset(assetId: string): Promise<SimpleResult> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return ctx
    if (!isUuid(assetId)) return { ok: false, error: "Invalid asset." }

    const { data: asset } = await ctx.supabase
      .from("dasher_boards_assets")
      .select("id, rink_id, facility_id, asset_type, label, sequence_position, is_active")
      .eq("id", assetId)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle()
    if (!asset) return { ok: false, error: "Asset not found." }
    if (asset.asset_type === "glass_panel") {
      return { ok: false, error: "Glass is deactivated per position, not removed." }
    }
    if (asset.sequence_position === null) {
      return { ok: false, error: "Asset is already retired." }
    }

    const { data: glassChild } = await ctx.supabase
      .from("dasher_boards_assets")
      .select("id")
      .eq("parent_board_id", assetId)
      .eq("asset_type", "glass_panel")
      .maybeSingle()

    const targetIds = [assetId, ...(glassChild ? [glassChild.id] : [])]
    const { count: issueCount } = await ctx.supabase
      .from("dasher_boards_issues")
      .select("id", { count: "exact", head: true })
      .in("asset_id", targetIds)

    const oldPosition = asset.sequence_position

    if ((issueCount ?? 0) > 0) {
      // Soft-retire: keep the row (and its label — permanently retired for
      // reuse purposes only when relabeled/converted; a retired-but-live row
      // still holds its label under the rink's uniqueness).
      const { error } = await ctx.supabase
        .from("dasher_boards_assets")
        .update({ is_active: false, sequence_position: null })
        .eq("id", assetId)
      if (error) {
        return { ok: false, error: dbError(error, "Failed to retire the asset.") }
      }
      if (glassChild) {
        await ctx.supabase
          .from("dasher_boards_assets")
          .update({ is_active: false })
          .eq("id", glassChild.id)
      }
      await recordAssetEvents(ctx, [
        { assetId, eventType: "deactivated", detail: { label: asset.label, freed_position: oldPosition } },
        ...(glassChild
          ? [{ assetId: glassChild.id, eventType: "deactivated" as EventType, detail: { reason: "parent_retired" } }]
          : []),
      ])
    } else {
      // No history ever: hard delete (the glass child cascades via FK).
      const { error } = await ctx.supabase
        .from("dasher_boards_assets")
        .delete()
        .eq("id", assetId)
      if (error) {
        return { ok: false, error: dbError(error, "Failed to delete the asset.") }
      }
    }

    const { error: shiftErr } = await ctx.supabase.rpc(
      "dasher_boards_shift_positions",
      { p_rink_id: asset.rink_id, p_from: oldPosition + 1, p_delta: -1 },
    )
    if (shiftErr) {
      logServerError("admin/dasher-boards/removeAsset:shift", shiftErr)
    }

    revalidateModule()
    return { ok: true }
  } catch (e) {
    logServerError("admin/dasher-boards/removeAsset", e)
    return { ok: false, error: "Failed to remove the asset." }
  }
}

/** Relabels an asset. Uniqueness + retired-label rejection are DB-enforced. */
export async function relabelAsset(
  assetId: string,
  newLabel: string,
): Promise<SimpleResult> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return ctx
    if (!isUuid(assetId)) return { ok: false, error: "Invalid asset." }
    const label = newLabel.trim()
    if (!LABEL_RE.test(label)) {
      return {
        ok: false,
        error: "Labels are 1–16 letters, digits, or hyphens (e.g. B12).",
      }
    }

    const { data: asset } = await ctx.supabase
      .from("dasher_boards_assets")
      .select("id, label")
      .eq("id", assetId)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle()
    if (!asset) return { ok: false, error: "Asset not found." }
    if (asset.label === label) return { ok: true }

    const { error } = await ctx.supabase
      .from("dasher_boards_assets")
      .update({ label })
      .eq("id", assetId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to relabel.") }
    }
    await recordAssetEvents(ctx, [
      { assetId, eventType: "relabeled", detail: { from_label: asset.label, to_label: label } },
    ])
    revalidateModule()
    return { ok: true }
  } catch (e) {
    logServerError("admin/dasher-boards/relabelAsset", e)
    return { ok: false, error: "Failed to relabel." }
  }
}

/** Glass on/off per position (sections with no shielding). Glass rows only. */
export async function toggleGlass(
  assetId: string,
  active: boolean,
): Promise<SimpleResult> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return ctx
    if (!isUuid(assetId)) return { ok: false, error: "Invalid asset." }

    const { data, error } = await ctx.supabase
      .from("dasher_boards_assets")
      .update({ is_active: active })
      .eq("id", assetId)
      .eq("facility_id", ctx.facilityId)
      .eq("asset_type", "glass_panel")
      .select("id")
    if (error) {
      return { ok: false, error: dbError(error, "Failed to toggle glass.") }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Glass panel not found." }
    }
    await recordAssetEvents(ctx, [
      { assetId, eventType: "glass_toggled", detail: { active } },
    ])
    revalidateModule()
    return { ok: true }
  } catch (e) {
    logServerError("admin/dasher-boards/toggleGlass", e)
    return { ok: false, error: "Failed to toggle glass." }
  }
}

function validateSpec(spec: GlassSpecInput): string | null {
  for (const [label, v] of [
    ["width", spec.widthIn],
    ["height", spec.heightIn],
    ["thickness", spec.thicknessIn],
  ] as const) {
    if (v !== null && (!Number.isFinite(v) || v <= 0)) {
      return `Glass ${label} must be a positive number of inches.`
    }
  }
  if (spec.material !== null && !isGlassMaterial(spec.material)) {
    return "Invalid glass material."
  }
  return null
}

/** Replacement spec for one glass panel or door (doors own their glass). */
export async function setGlassSpec(
  assetId: string,
  spec: GlassSpecInput,
): Promise<SimpleResult> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return ctx
    if (!isUuid(assetId)) return { ok: false, error: "Invalid asset." }
    const invalid = validateSpec(spec)
    if (invalid) return { ok: false, error: invalid }

    const { data, error } = await ctx.supabase
      .from("dasher_boards_assets")
      .update({
        glass_width_in: spec.widthIn,
        glass_height_in: spec.heightIn,
        glass_thickness_in: spec.thicknessIn,
        glass_material: spec.material,
        spec_notes: spec.notes,
      })
      .eq("id", assetId)
      .eq("facility_id", ctx.facilityId)
      .in("asset_type", ["glass_panel", "door"])
      .select("id")
    if (error) {
      return { ok: false, error: dbError(error, "Failed to save the spec.") }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Only glass panels and doors carry a spec." }
    }
    await recordAssetEvents(ctx, [
      { assetId, eventType: "spec_updated", detail: { ...spec } },
    ])
    revalidateModule()
    return { ok: true }
  } catch (e) {
    logServerError("admin/dasher-boards/setGlassSpec", e)
    return { ok: false, error: "Failed to save the spec." }
  }
}

/**
 * Applies one spec to many assets — the PRIMARY spec-entry path (one side-panel
 * size + a handful of exceptions). Per-asset setGlassSpec is the override path.
 */
export async function bulkSetGlassSpec(
  rinkId: string,
  assetIds: string[],
  spec: GlassSpecInput,
): Promise<SimpleResult & { updated?: number }> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return ctx
    if (!isUuid(rinkId)) return { ok: false, error: "Invalid rink." }
    if (assetIds.length === 0) return { ok: false, error: "Select at least one asset." }
    if (assetIds.length > 500 || assetIds.some((id) => !isUuid(id))) {
      return { ok: false, error: "Invalid asset selection." }
    }
    const invalid = validateSpec(spec)
    if (invalid) return { ok: false, error: invalid }

    const { data, error } = await ctx.supabase
      .from("dasher_boards_assets")
      .update({
        glass_width_in: spec.widthIn,
        glass_height_in: spec.heightIn,
        glass_thickness_in: spec.thicknessIn,
        glass_material: spec.material,
        spec_notes: spec.notes,
      })
      .eq("rink_id", rinkId)
      .eq("facility_id", ctx.facilityId)
      .in("id", assetIds)
      .in("asset_type", ["glass_panel", "door"])
      .select("id")
    if (error) {
      return { ok: false, error: dbError(error, "Failed to apply the spec.") }
    }
    await recordAssetEvents(
      ctx,
      (data ?? []).map((row) => ({
        assetId: row.id,
        eventType: "spec_updated" as EventType,
        detail: { ...spec, bulk: true },
      })),
    )
    revalidateModule()
    return { ok: true, updated: data?.length ?? 0 }
  } catch (e) {
    logServerError("admin/dasher-boards/bulkSetGlassSpec", e)
    return { ok: false, error: "Failed to apply the spec." }
  }
}

// ============================================================================
// Managed lists: door subtypes, issue categories, checklist items
// ============================================================================

export async function upsertSubtype(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const label = nonEmpty(formData.get("label"))
    if (!label) return { ok: false, error: "Label is required." }
    const assetType = nonEmpty(formData.get("asset_type")) ?? "door"
    if (!isAssetType(assetType)) return { ok: false, error: "Invalid asset type." }
    const sortOrder = asInt(formData.get("sort_order")) ?? 0
    const id = nonEmpty(formData.get("id"))

    if (id) {
      if (!isUuid(id)) return { ok: false, error: "Invalid subtype." }
      const { data, error } = await ctx.supabase
        .from("dasher_boards_asset_subtypes")
        .update({ label, sort_order: sortOrder })
        .eq("id", id)
        .eq("facility_id", ctx.facilityId)
        .select("id")
      if (error) return { ok: false, error: dbError(error, "Failed to update subtype.") }
      if (!data || data.length === 0) return { ok: false, error: "Subtype not found." }
    } else {
      const { error } = await ctx.supabase
        .from("dasher_boards_asset_subtypes")
        .insert({
          facility_id: ctx.facilityId,
          asset_type: assetType,
          label,
          sort_order: sortOrder,
        })
      if (error) return { ok: false, error: dbError(error, "Failed to create subtype.") }
    }
    revalidateModule()
    return { ok: true, message: id ? "Subtype updated." : "Subtype created." }
  } catch (e) {
    logServerError("admin/dasher-boards/upsertSubtype", e)
    return { ok: false, error: "Failed to save subtype." }
  }
}

export async function setSubtypeActive(
  id: string,
  active: boolean,
): Promise<SimpleResult> {
  return setRowActive("dasher_boards_asset_subtypes", id, active)
}

export async function upsertIssueCategory(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const label = nonEmpty(formData.get("label"))
    if (!label) return { ok: false, error: "Label is required." }
    const assetType = nonEmpty(formData.get("asset_type"))
    if (!assetType || !isAssetType(assetType)) {
      return { ok: false, error: "Invalid asset type." }
    }
    const sortOrder = asInt(formData.get("sort_order")) ?? 0
    const id = nonEmpty(formData.get("id"))

    if (id) {
      if (!isUuid(id)) return { ok: false, error: "Invalid category." }
      const { data, error } = await ctx.supabase
        .from("dasher_boards_issue_categories")
        .update({ label, sort_order: sortOrder })
        .eq("id", id)
        .eq("facility_id", ctx.facilityId)
        .select("id")
      if (error) return { ok: false, error: dbError(error, "Failed to update category.") }
      if (!data || data.length === 0) return { ok: false, error: "Category not found." }
    } else {
      const { error } = await ctx.supabase
        .from("dasher_boards_issue_categories")
        .insert({
          facility_id: ctx.facilityId,
          asset_type: assetType,
          label,
          sort_order: sortOrder,
        })
      if (error) return { ok: false, error: dbError(error, "Failed to create category.") }
    }
    revalidateModule()
    return { ok: true, message: id ? "Category updated." : "Category created." }
  } catch (e) {
    logServerError("admin/dasher-boards/upsertIssueCategory", e)
    return { ok: false, error: "Failed to save category." }
  }
}

export async function setIssueCategoryActive(
  id: string,
  active: boolean,
): Promise<SimpleResult> {
  return setRowActive("dasher_boards_issue_categories", id, active)
}

export async function upsertChecklistItem(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const label = nonEmpty(formData.get("label"))
    if (!label) return { ok: false, error: "Label is required." }
    const cadence = nonEmpty(formData.get("cadence"))
    if (!cadence || !isCadence(cadence)) {
      return { ok: false, error: "Cadence must be daily, weekly, monthly, or yearly." }
    }
    const dueMonth = asInt(formData.get("due_month"))
    if (cadence === "yearly") {
      if (!dueMonth || dueMonth < 1 || dueMonth > 12) {
        return { ok: false, error: "Yearly items need a due month (1–12)." }
      }
    } else if (dueMonth !== null) {
      return { ok: false, error: "Only yearly items take a due month." }
    }
    const sortOrder = asInt(formData.get("sort_order")) ?? 0
    const id = nonEmpty(formData.get("id"))

    if (id) {
      if (!isUuid(id)) return { ok: false, error: "Invalid item." }
      const { data, error } = await ctx.supabase
        .from("dasher_boards_checklist_items")
        .update({
          label,
          cadence,
          due_month: cadence === "yearly" ? dueMonth : null,
          sort_order: sortOrder,
        })
        .eq("id", id)
        .eq("facility_id", ctx.facilityId)
        .select("id")
      if (error) return { ok: false, error: dbError(error, "Failed to update item.") }
      if (!data || data.length === 0) return { ok: false, error: "Item not found." }
    } else {
      const rinkId = nonEmpty(formData.get("rink_id"))
      if (!rinkId || !isUuid(rinkId)) return { ok: false, error: "Invalid rink." }
      const { data: rink } = await ctx.supabase
        .from("dasher_boards_rinks")
        .select("id")
        .eq("id", rinkId)
        .eq("facility_id", ctx.facilityId)
        .maybeSingle()
      if (!rink) return { ok: false, error: "Rink not found." }
      const { error } = await ctx.supabase
        .from("dasher_boards_checklist_items")
        .insert({
          facility_id: ctx.facilityId,
          rink_id: rinkId,
          label,
          cadence,
          due_month: cadence === "yearly" ? dueMonth : null,
          sort_order: sortOrder,
        })
      if (error) return { ok: false, error: dbError(error, "Failed to create item.") }
    }
    revalidateModule()
    return { ok: true, message: id ? "Checklist item updated." : "Checklist item created." }
  } catch (e) {
    logServerError("admin/dasher-boards/upsertChecklistItem", e)
    return { ok: false, error: "Failed to save the checklist item." }
  }
}

export async function setChecklistItemActive(
  id: string,
  active: boolean,
): Promise<SimpleResult> {
  return setRowActive("dasher_boards_checklist_items", id, active)
}

// ---------------------------------------------------------------------------
// Shared managed-list helpers (activate/deactivate + reorder)
// ---------------------------------------------------------------------------

const MANAGED_LIST_TABLES = [
  "dasher_boards_asset_subtypes",
  "dasher_boards_issue_categories",
  "dasher_boards_checklist_items",
] as const
type ManagedListTable = (typeof MANAGED_LIST_TABLES)[number]

// Server actions are network-reachable: the table name must be validated at
// runtime, not just typed — a forged request could pass any string.
function isManagedListTable(v: string): v is ManagedListTable {
  return (MANAGED_LIST_TABLES as readonly string[]).includes(v)
}

async function setRowActive(
  table: ManagedListTable,
  id: string,
  active: boolean,
): Promise<SimpleResult> {
  try {
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return ctx
    if (!isUuid(id)) return { ok: false, error: "Invalid id." }
    const { data, error } = await ctx.supabase
      .from(table)
      .update({ is_active: active })
      .eq("id", id)
      .eq("facility_id", ctx.facilityId)
      .select("id")
    if (error) return { ok: false, error: dbError(error, "Failed to update.") }
    if (!data || data.length === 0) return { ok: false, error: "Not found." }
    revalidateModule()
    return { ok: true }
  } catch (e) {
    logServerError(`admin/dasher-boards/setRowActive:${table}`, e)
    return { ok: false, error: "Failed to update." }
  }
}

/**
 * Moves a managed-list row up/down by swapping sort_order with its neighbor
 * within the same scope (asset_type for subtypes/categories, rink for
 * checklist items). No unique constraint exists on sort_order, so a plain
 * two-statement swap suffices.
 */
export async function moveManagedRow(
  table: ManagedListTable,
  id: string,
  direction: -1 | 1,
): Promise<SimpleResult> {
  try {
    if (!isManagedListTable(table)) return { ok: false, error: "Invalid list." }
    const ctx = await resolveAdminContext()
    if (!ctx.ok) return ctx
    if (!isUuid(id)) return { ok: false, error: "Invalid id." }

    const { data: row } = await ctx.supabase
      .from(table)
      .select("id, sort_order")
      .eq("id", id)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle()
    if (!row) return { ok: false, error: "Not found." }

    // Reorder within the row's scope: rink for checklist items, asset_type
    // for subtypes/categories. `.filter()` takes the column loosely — the
    // union table type has no common scope column for `.eq()` to accept.
    let scopeCol: string
    let scopeVal: string
    if (table === "dasher_boards_checklist_items") {
      const { data } = await ctx.supabase
        .from("dasher_boards_checklist_items")
        .select("rink_id")
        .eq("id", id)
        .maybeSingle()
      if (!data) return { ok: false, error: "Not found." }
      scopeCol = "rink_id"
      scopeVal = data.rink_id
    } else if (table === "dasher_boards_asset_subtypes") {
      const { data } = await ctx.supabase
        .from("dasher_boards_asset_subtypes")
        .select("asset_type")
        .eq("id", id)
        .maybeSingle()
      if (!data) return { ok: false, error: "Not found." }
      scopeCol = "asset_type"
      scopeVal = data.asset_type
    } else {
      const { data } = await ctx.supabase
        .from("dasher_boards_issue_categories")
        .select("asset_type")
        .eq("id", id)
        .maybeSingle()
      if (!data) return { ok: false, error: "Not found." }
      scopeCol = "asset_type"
      scopeVal = data.asset_type
    }

    const neighborQuery = ctx.supabase
      .from(table)
      .select("id, sort_order")
      .eq("facility_id", ctx.facilityId)
      .neq("id", id)
      .filter(scopeCol, "eq", scopeVal)
    const { data: neighbor } = await (direction === -1
      ? neighborQuery
          .lte("sort_order", row.sort_order)
          .order("sort_order", { ascending: false })
      : neighborQuery
          .gte("sort_order", row.sort_order)
          .order("sort_order", { ascending: true })
    )
      .limit(1)
      .maybeSingle()
    if (!neighbor) return { ok: true } // already at the edge

    const { error: e1 } = await ctx.supabase
      .from(table)
      .update({ sort_order: neighbor.sort_order })
      .eq("id", id)
    const { error: e2 } = await ctx.supabase
      .from(table)
      .update({ sort_order: row.sort_order })
      .eq("id", neighbor.id)
    if (e1 || e2) {
      return { ok: false, error: dbError(e1 ?? e2, "Failed to reorder.") }
    }
    revalidateModule()
    return { ok: true }
  } catch (e) {
    logServerError(`admin/dasher-boards/moveManagedRow:${table}`, e)
    return { ok: false, error: "Failed to reorder." }
  }
}
