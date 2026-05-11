"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import type {
  ActionState,
  AlertOn,
  MeasurementUnit,
  Severity,
  SimpleResult,
} from "./types"
import { isAlertOn, isMeasurementUnit, isSeverity } from "./types"

type SupabaseError = { code?: string; message?: string } | null

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const HEX_RE = /^#[0-9a-fA-F]{6}$/

// Magic offset for the temp-negative renumber trick. Keeps temp values well
// outside the realistic range of point_number / sort_order so we never collide
// with real data during multi-step swaps.
const TEMP_OFFSET = 100000

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

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  const msg = err.message?.trim() ?? ""
  if (err.code === "23505") {
    return "That value conflicts with an existing record (duplicate)."
  }
  if (err.code === "23503") {
    return "Cannot complete: a related record prevents this change."
  }
  if (err.code === "P0001") {
    if (/active ice_depth_layouts/i.test(msg)) {
      return "Maximum 8 active layouts reached. Deactivate one first."
    }
    if (/active ice_depth_points/i.test(msg)) {
      return "Maximum 60 active points reached."
    }
    return msg || fallback
  }
  return msg || fallback
}

async function resolveFacility(): Promise<
  { ok: true; facilityId: string } | { ok: false; error: string }
> {
  const current = await getCurrentUser()
  const profile = current?.profile
  if (!profile) return { ok: false, error: "Not signed in." }
  if (!profile.facility_id) {
    return { ok: false, error: "No facility assigned to your account." }
  }
  return { ok: true, facilityId: profile.facility_id }
}

// ============================================================================
// Layouts
// ============================================================================

export async function createLayout(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const name = nonEmpty(formData.get("name"))
    if (!name) return { ok: false, error: "Name is required." }

    const rawSlug = nonEmpty(formData.get("slug"))
    const slug = rawSlug ?? slugify(name)
    if (!SLUG_RE.test(slug)) {
      return {
        ok: false,
        error:
          "Slug must be lowercase letters, digits, and hyphens (e.g. main-rink).",
      }
    }
    const description = nonEmpty(formData.get("description"))
    const aspect = asNumber(formData.get("diagram_aspect_ratio"))
    const sort_order = asInt(formData.get("sort_order")) ?? 0

    const supabase = await createClient()
    const { error } = await supabase.from("ice_depth_layouts").insert({
      facility_id: facility.facilityId,
      name,
      slug,
      description,
      diagram_aspect_ratio: aspect ?? 0.425,
      sort_order,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to create layout.") }
    }
    revalidatePath("/admin/ice-depth")
    return { ok: true, message: "Layout created." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function updateLayout(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing layout id." }

    const name = nonEmpty(formData.get("name"))
    if (!name) return { ok: false, error: "Name is required." }
    const rawSlug = nonEmpty(formData.get("slug"))
    const slug = rawSlug ?? slugify(name)
    if (!SLUG_RE.test(slug)) {
      return {
        ok: false,
        error: "Slug must be lowercase letters, digits, and hyphens.",
      }
    }
    const description = nonEmpty(formData.get("description"))
    const aspect = asNumber(formData.get("diagram_aspect_ratio"))
    if (aspect !== null && (aspect <= 0 || aspect > 10)) {
      return { ok: false, error: "Aspect ratio must be between 0 and 10." }
    }
    const sort_order = asInt(formData.get("sort_order"))
    const logo_url = nonEmpty(formData.get("logo_url"))

    const supabase = await createClient()
    const { error } = await supabase
      .from("ice_depth_layouts")
      .update({
        name,
        slug,
        description,
        logo_url,
        ...(aspect !== null ? { diagram_aspect_ratio: aspect } : {}),
        ...(sort_order !== null ? { sort_order } : {}),
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update layout.") }
    }
    revalidatePath("/admin/ice-depth")
    return { ok: true, message: "Layout updated." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function setLayoutActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing layout id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("ice_depth_layouts")
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update layout.") }
    }
    revalidatePath("/admin/ice-depth")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteLayout(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing layout id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("ice_depth_layouts")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      if (error.code === "23503") {
        return {
          ok: false,
          error: "Layout has sessions; deactivate instead.",
        }
      }
      return { ok: false, error: dbError(error, "Failed to delete layout.") }
    }
    revalidatePath("/admin/ice-depth")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Points
// ============================================================================

export async function createPoint(
  layoutId: string,
  x: number,
  y: number,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!layoutId) return { ok: false, error: "Missing layout id." }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, error: "Invalid coordinates." }
    }
    const xc = Math.min(1, Math.max(0, x))
    const yc = Math.min(1, Math.max(0, y))

    const supabase = await createClient()

    // Compute next point_number among ALL points (active + inactive) in this
    // layout to keep (layout_id, point_number) unique even after reactivation
    // of older points.
    const { data: existing, error: exErr } = await supabase
      .from("ice_depth_points")
      .select("point_number")
      .eq("layout_id", layoutId)
      .order("point_number", { ascending: false })
      .limit(1)
    if (exErr) {
      return { ok: false, error: dbError(exErr, "Failed to read points.") }
    }
    const nextNumber = (existing?.[0]?.point_number ?? 0) + 1

    const { error } = await supabase.from("ice_depth_points").insert({
      facility_id: facility.facilityId,
      layout_id: layoutId,
      point_number: nextNumber,
      sort_order: nextNumber,
      x_position: xc,
      y_position: yc,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to add point.") }
    }
    revalidatePath("/admin/ice-depth")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function updatePoint(
  id: string,
  patch: {
    label?: string | null
    x?: number
    y?: number
    sort_order?: number
    is_active?: boolean
  },
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing point id." }

    const update: {
      label?: string | null
      x_position?: number
      y_position?: number
      sort_order?: number
      is_active?: boolean
    } = {}

    if (Object.prototype.hasOwnProperty.call(patch, "label")) {
      const labelVal = patch.label
      update.label =
        typeof labelVal === "string"
          ? labelVal.trim().length === 0
            ? null
            : labelVal.trim().slice(0, 200)
          : null
    }
    if (typeof patch.x === "number" && Number.isFinite(patch.x)) {
      update.x_position = Math.min(1, Math.max(0, patch.x))
    }
    if (typeof patch.y === "number" && Number.isFinite(patch.y)) {
      update.y_position = Math.min(1, Math.max(0, patch.y))
    }
    if (typeof patch.sort_order === "number" && Number.isFinite(patch.sort_order)) {
      update.sort_order = Math.trunc(patch.sort_order)
    }
    if (typeof patch.is_active === "boolean") {
      update.is_active = patch.is_active
    }

    if (Object.keys(update).length === 0) return { ok: true }

    const supabase = await createClient()
    const { error } = await supabase
      .from("ice_depth_points")
      .update(update)
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update point.") }
    }
    revalidatePath("/admin/ice-depth")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function movePoint(
  id: string,
  direction: -1 | 1,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing point id." }
    const supabase = await createClient()

    const { data: cur, error: curErr } = await supabase
      .from("ice_depth_points")
      .select("id, layout_id, point_number, sort_order, is_active")
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    if (curErr || !cur) {
      return { ok: false, error: dbError(curErr, "Point not found.") }
    }

    // Find the adjacent active point by point_number within the same layout.
    const neighborQuery = supabase
      .from("ice_depth_points")
      .select("id, point_number, sort_order")
      .eq("layout_id", cur.layout_id)
      .eq("is_active", true)
      .neq("id", cur.id)

    const { data: neighbor, error: nErr } =
      direction < 0
        ? await neighborQuery
            .lt("point_number", cur.point_number)
            .order("point_number", { ascending: false })
            .limit(1)
            .maybeSingle()
        : await neighborQuery
            .gt("point_number", cur.point_number)
            .order("point_number", { ascending: true })
            .limit(1)
            .maybeSingle()

    if (nErr) return { ok: false, error: dbError(nErr, "Failed to reorder.") }
    if (!neighbor) return { ok: true }

    // Three-step swap using a temp negative number to dodge the
    // (layout_id, point_number) unique constraint.
    const tmp = -(TEMP_OFFSET + cur.point_number)
    const { error: e1 } = await supabase
      .from("ice_depth_points")
      .update({ point_number: tmp })
      .eq("id", cur.id)
      .eq("facility_id", facility.facilityId)
    if (e1) return { ok: false, error: dbError(e1, "Failed to reorder.") }

    const { error: e2 } = await supabase
      .from("ice_depth_points")
      .update({
        point_number: cur.point_number,
        sort_order: cur.sort_order,
      })
      .eq("id", neighbor.id)
      .eq("facility_id", facility.facilityId)
    if (e2) return { ok: false, error: dbError(e2, "Failed to reorder.") }

    const { error: e3 } = await supabase
      .from("ice_depth_points")
      .update({
        point_number: neighbor.point_number,
        sort_order: neighbor.sort_order,
      })
      .eq("id", cur.id)
      .eq("facility_id", facility.facilityId)
    if (e3) return { ok: false, error: dbError(e3, "Failed to reorder.") }

    revalidatePath("/admin/ice-depth")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deletePoint(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing point id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("ice_depth_points")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      // FK on measurements is ON DELETE SET NULL so deletion should succeed
      // even if historical measurements reference this point.
      return { ok: false, error: dbError(error, "Failed to delete point.") }
    }
    revalidatePath("/admin/ice-depth")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/**
 * Compact gaps in point_number for active points in a layout. Inactive points
 * are renumbered to the end so they never collide with active numbers. Uses
 * the temp-negative trick: first set every row to NEG(point_number) - offset,
 * then assign final numbers in sort order.
 */
export async function renumberPointsForLayout(
  layoutId: string,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!layoutId) return { ok: false, error: "Missing layout id." }
    const supabase = await createClient()

    const { data: points, error: lerr } = await supabase
      .from("ice_depth_points")
      .select("id, is_active, point_number, sort_order")
      .eq("layout_id", layoutId)
      .eq("facility_id", facility.facilityId)
    if (lerr) {
      return { ok: false, error: dbError(lerr, "Failed to read points.") }
    }
    const all = points ?? []
    if (all.length === 0) return { ok: true }

    // 1) Park every row in the negative range so the unique constraint on
    //    (layout_id, point_number) cannot collide while we shuffle.
    for (const p of all) {
      const tmp = -(TEMP_OFFSET + Math.abs(p.point_number) + 1)
      const { error } = await supabase
        .from("ice_depth_points")
        .update({ point_number: tmp })
        .eq("id", p.id)
        .eq("facility_id", facility.facilityId)
      if (error) {
        return { ok: false, error: dbError(error, "Failed to renumber.") }
      }
    }

    // 2) Sort active points by current sort_order, then point_number; assign
    //    1..N. Inactive points get pushed to the tail so future inserts can
    //    reuse the next free number.
    const active = all
      .filter((p) => p.is_active)
      .sort(
        (a, b) =>
          a.sort_order - b.sort_order || a.point_number - b.point_number,
      )
    const inactive = all
      .filter((p) => !p.is_active)
      .sort(
        (a, b) =>
          a.sort_order - b.sort_order || a.point_number - b.point_number,
      )

    let n = 0
    for (const p of active) {
      n += 1
      const { error } = await supabase
        .from("ice_depth_points")
        .update({ point_number: n, sort_order: n })
        .eq("id", p.id)
        .eq("facility_id", facility.facilityId)
      if (error) {
        return { ok: false, error: dbError(error, "Failed to renumber.") }
      }
    }
    for (const p of inactive) {
      n += 1
      const { error } = await supabase
        .from("ice_depth_points")
        .update({ point_number: n, sort_order: n })
        .eq("id", p.id)
        .eq("facility_id", facility.facilityId)
      if (error) {
        return { ok: false, error: dbError(error, "Failed to renumber.") }
      }
    }

    revalidatePath("/admin/ice-depth")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Sessions + follow-up notes
// ============================================================================

export async function addIceDepthFollowupNote(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const session_id = nonEmpty(formData.get("session_id"))
    if (!session_id) return { ok: false, error: "Missing session id." }
    const body = nonEmpty(formData.get("body"))
    if (!body) return { ok: false, error: "Note cannot be empty." }

    const current = await getCurrentUser()
    const supabase = await createClient()
    let employee_id: string | null = null
    if (current?.profile?.id) {
      const { data: emp } = await supabase
        .from("employees")
        .select("id")
        .eq("user_id", current.profile.id)
        .eq("facility_id", facility.facilityId)
        .eq("is_active", true)
        .maybeSingle()
      employee_id = emp?.id ?? null
    }

    const { error } = await supabase.from("ice_depth_followup_notes").insert({
      facility_id: facility.facilityId,
      session_id,
      employee_id,
      body,
      is_admin_note: true,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to add note.") }
    }
    revalidatePath("/admin/ice-depth")
    return { ok: true, message: "Note added." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteIceDepthSession(
  sessionId: string,
): Promise<SimpleResult> {
  try {
    const current = await requireAdmin()
    if (!sessionId) return { ok: false, error: "Missing session id." }
    const supabase = await createClient()
    const facilityId = current.profile?.facility_id ?? null
    let query = supabase
      .from("ice_depth_sessions")
      .delete()
      .eq("id", sessionId)
    if (facilityId) {
      query = query.eq("facility_id", facilityId)
    }
    const { error } = await query
    if (error) {
      // RLS will block non-super-admin with permission denied.
      return { ok: false, error: dbError(error, "Failed to delete session.") }
    }
    revalidatePath("/admin/ice-depth")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Settings
// ============================================================================

export async function updateIceDepthSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const unitRaw = nonEmpty(formData.get("measurement_unit")) ?? "inches"
    if (!isMeasurementUnit(unitRaw)) {
      return { ok: false, error: "Invalid measurement unit." }
    }
    const measurement_unit: MeasurementUnit = unitRaw

    const low_threshold = asNumber(formData.get("low_threshold"))
    const high_threshold = asNumber(formData.get("high_threshold"))
    if (low_threshold === null || high_threshold === null) {
      return { ok: false, error: "Both low and high thresholds are required." }
    }
    if (low_threshold >= high_threshold) {
      return {
        ok: false,
        error: "Low threshold must be less than high threshold.",
      }
    }

    const low_color = nonEmpty(formData.get("low_color")) ?? "#1d4ed8"
    const ok_color = nonEmpty(formData.get("ok_color")) ?? "#16a34a"
    const high_color = nonEmpty(formData.get("high_color")) ?? "#dc2626"
    for (const c of [low_color, ok_color, high_color]) {
      if (!HEX_RE.test(c)) {
        return { ok: false, error: "Colors must be 6-digit hex (e.g. #1d4ed8)." }
      }
    }

    const alerts_enabled = formData.get("alerts_enabled") === "on"

    const alertOnRaw = nonEmpty(formData.get("alert_on")) ?? "any"
    if (!isAlertOn(alertOnRaw)) {
      return { ok: false, error: "Invalid alert trigger." }
    }
    const alert_on: AlertOn = alertOnRaw

    const sevRaw = nonEmpty(formData.get("default_alert_severity")) ?? "warn"
    if (!isSeverity(sevRaw)) {
      return { ok: false, error: "Invalid default severity." }
    }
    const default_alert_severity: Severity = sevRaw

    const supabase = await createClient()
    const { error } = await supabase.from("ice_depth_settings").upsert(
      {
        facility_id: facility.facilityId,
        measurement_unit,
        low_threshold,
        high_threshold,
        low_color,
        ok_color,
        high_color,
        alerts_enabled,
        alert_on,
        default_alert_severity,
      },
      { onConflict: "facility_id" },
    )
    if (error) {
      return { ok: false, error: dbError(error, "Failed to save settings.") }
    }
    revalidatePath("/admin/ice-depth")
    return { ok: true, message: "Settings saved." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Seed defaults
//
// The DB has a SECURITY DEFINER `seed_default_ice_depth_settings(uuid)` but
// it's service_role only, so we replicate the upsert inline so the call works
// under the admin's session. Idempotent via the unique facility_id constraint.
// Inserts the settings row only — admins build layouts and points themselves.
// ============================================================================

export async function seedDefaultIceDepthSettings(): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const supabase = await createClient()
    const { error } = await supabase.from("ice_depth_settings").upsert(
      {
        facility_id: facility.facilityId,
      },
      { onConflict: "facility_id", ignoreDuplicates: true },
    )
    if (error) {
      return { ok: false, error: dbError(error, "Failed to seed settings.") }
    }
    revalidatePath("/admin/ice-depth")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

