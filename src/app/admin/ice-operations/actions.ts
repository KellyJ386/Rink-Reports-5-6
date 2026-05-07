"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import type {
  ActionState,
  EquipmentType,
  Severity,
  SimpleResult,
  TemperatureUnit,
} from "./types"
import {
  CIRCLE_CHECK_BULK_CAP,
  isEquipmentType,
  isSeverity,
  isTemperatureUnit,
} from "./types"

type SupabaseError = { code?: string; message?: string } | null

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

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
  if (err.code === "23505") {
    return "That value conflicts with an existing record (duplicate)."
  }
  if (err.code === "23503") {
    return "Cannot complete: a related record prevents this change."
  }
  if (err.code === "P0001") {
    return err.message?.trim() || fallback
  }
  return err.message?.trim() || fallback
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
// Rinks
// ============================================================================

export async function createRink(
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
    const sort_order = asInt(formData.get("sort_order")) ?? 0

    const supabase = await createClient()
    const { error } = await supabase.from("ice_operations_rinks").insert({
      facility_id: facility.facilityId,
      name,
      slug,
      sort_order,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to create rink.") }
    }
    revalidatePath("/admin/ice-operations")
    return { ok: true, message: "Rink created." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function updateRink(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing rink id." }
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
    const sort_order = asInt(formData.get("sort_order"))

    const supabase = await createClient()
    const { error } = await supabase
      .from("ice_operations_rinks")
      .update({
        name,
        slug,
        ...(sort_order !== null ? { sort_order } : {}),
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update rink.") }
    }
    revalidatePath("/admin/ice-operations")
    return { ok: true, message: "Rink updated." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function setRinkActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing rink id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("ice_operations_rinks")
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update rink.") }
    }
    revalidatePath("/admin/ice-operations")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteRink(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing rink id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("ice_operations_rinks")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      if (error.code === "23503") {
        return { ok: false, error: "Rink in use; deactivate instead." }
      }
      return { ok: false, error: dbError(error, "Failed to delete rink.") }
    }
    revalidatePath("/admin/ice-operations")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Equipment
// ============================================================================

export async function createEquipment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const name = nonEmpty(formData.get("name"))
    if (!name) return { ok: false, error: "Name is required." }
    const typeRaw = nonEmpty(formData.get("equipment_type")) ?? ""
    if (!isEquipmentType(typeRaw)) {
      return { ok: false, error: "Invalid equipment type." }
    }
    const equipment_type: EquipmentType = typeRaw

    const rawSlug = nonEmpty(formData.get("slug"))
    const slug = rawSlug ?? slugify(name)
    if (!SLUG_RE.test(slug)) {
      return {
        ok: false,
        error: "Slug must be lowercase letters, digits, and hyphens.",
      }
    }
    const model = nonEmpty(formData.get("model"))
    const serial_number = nonEmpty(formData.get("serial_number"))
    const hours_count = asNumber(formData.get("hours_count"))
    const sort_order = asInt(formData.get("sort_order")) ?? 0
    const is_active = formData.get("is_active") !== "off"

    const supabase = await createClient()
    const { error } = await supabase.from("ice_operations_equipment").insert({
      facility_id: facility.facilityId,
      name,
      slug,
      equipment_type,
      model,
      serial_number,
      hours_count,
      sort_order,
      is_active,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to create equipment.") }
    }
    revalidatePath("/admin/ice-operations")
    return { ok: true, message: "Equipment created." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function updateEquipment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing equipment id." }

    const name = nonEmpty(formData.get("name"))
    if (!name) return { ok: false, error: "Name is required." }
    const typeRaw = nonEmpty(formData.get("equipment_type")) ?? ""
    if (!isEquipmentType(typeRaw)) {
      return { ok: false, error: "Invalid equipment type." }
    }
    const equipment_type: EquipmentType = typeRaw

    const rawSlug = nonEmpty(formData.get("slug"))
    const slug = rawSlug ?? slugify(name)
    if (!SLUG_RE.test(slug)) {
      return {
        ok: false,
        error: "Slug must be lowercase letters, digits, and hyphens.",
      }
    }
    const model = nonEmpty(formData.get("model"))
    const serial_number = nonEmpty(formData.get("serial_number"))
    const hours_count = asNumber(formData.get("hours_count"))
    const sort_order = asInt(formData.get("sort_order"))

    const supabase = await createClient()
    const { error } = await supabase
      .from("ice_operations_equipment")
      .update({
        name,
        slug,
        equipment_type,
        model,
        serial_number,
        hours_count,
        ...(sort_order !== null ? { sort_order } : {}),
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update equipment.") }
    }
    revalidatePath("/admin/ice-operations")
    return { ok: true, message: "Equipment updated." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function setEquipmentActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing equipment id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("ice_operations_equipment")
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update equipment.") }
    }
    revalidatePath("/admin/ice-operations")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteEquipment(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing equipment id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("ice_operations_equipment")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      if (error.code === "23503") {
        return { ok: false, error: "Equipment in use; deactivate instead." }
      }
      return { ok: false, error: dbError(error, "Failed to delete equipment.") }
    }
    revalidatePath("/admin/ice-operations")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Circle check items
// ============================================================================

export async function createCircleCheckItem(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const label = nonEmpty(formData.get("label"))
    if (!label) return { ok: false, error: "Label is required." }
    const description = nonEmpty(formData.get("description"))
    const appliesRaw = nonEmpty(formData.get("applies_to_equipment_type"))
    let applies_to_equipment_type: string | null = null
    if (appliesRaw) {
      if (!isEquipmentType(appliesRaw)) {
        return { ok: false, error: "Invalid equipment type scope." }
      }
      applies_to_equipment_type = appliesRaw
    }

    const supabase = await createClient()
    const { data: maxRow } = await supabase
      .from("ice_operations_circle_check_items")
      .select("sort_order")
      .eq("facility_id", facility.facilityId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle()
    const nextSort = (maxRow?.sort_order ?? 0) + 1

    const { error } = await supabase
      .from("ice_operations_circle_check_items")
      .insert({
        facility_id: facility.facilityId,
        label,
        description,
        applies_to_equipment_type,
        sort_order: nextSort,
      })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to create item.") }
    }
    revalidatePath("/admin/ice-operations")
    return { ok: true, message: "Item created." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function updateCircleCheckItem(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing item id." }

    const label = nonEmpty(formData.get("label"))
    if (!label) return { ok: false, error: "Label is required." }
    const description = nonEmpty(formData.get("description"))
    const appliesRaw = nonEmpty(formData.get("applies_to_equipment_type"))
    let applies_to_equipment_type: string | null = null
    if (appliesRaw) {
      if (!isEquipmentType(appliesRaw)) {
        return { ok: false, error: "Invalid equipment type scope." }
      }
      applies_to_equipment_type = appliesRaw
    }

    const supabase = await createClient()
    const { error } = await supabase
      .from("ice_operations_circle_check_items")
      .update({
        label,
        description,
        applies_to_equipment_type,
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update item.") }
    }
    revalidatePath("/admin/ice-operations")
    return { ok: true, message: "Item updated." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function setCircleCheckItemActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing item id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("ice_operations_circle_check_items")
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update item.") }
    }
    revalidatePath("/admin/ice-operations")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteCircleCheckItem(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing item id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("ice_operations_circle_check_items")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      if (error.code === "23503") {
        return {
          ok: false,
          error: "Item is referenced by submitted results; deactivate instead.",
        }
      }
      return { ok: false, error: dbError(error, "Failed to delete item.") }
    }
    revalidatePath("/admin/ice-operations")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/**
 * Swap sort_order with the previous/next item (facility-scoped).
 * Uses the temp-negative trick to avoid unique constraint collisions.
 */
export async function moveCircleCheckItem(
  id: string,
  direction: -1 | 1,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing item id." }
    const supabase = await createClient()

    const { data: cur, error: curErr } = await supabase
      .from("ice_operations_circle_check_items")
      .select("id, facility_id, sort_order")
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    if (curErr || !cur) {
      return { ok: false, error: dbError(curErr, "Item not found.") }
    }

    const neighborQuery = supabase
      .from("ice_operations_circle_check_items")
      .select("id, sort_order")
      .eq("facility_id", cur.facility_id)
      .neq("id", cur.id)

    const { data: neighbor, error: nErr } =
      direction < 0
        ? await neighborQuery
            .lt("sort_order", cur.sort_order)
            .order("sort_order", { ascending: false })
            .limit(1)
            .maybeSingle()
        : await neighborQuery
            .gt("sort_order", cur.sort_order)
            .order("sort_order", { ascending: true })
            .limit(1)
            .maybeSingle()

    if (nErr) return { ok: false, error: dbError(nErr, "Failed to reorder.") }
    if (!neighbor) return { ok: true }

    const tmp = -1 - Math.abs(cur.sort_order) - Math.abs(neighbor.sort_order)
    const { error: e1 } = await supabase
      .from("ice_operations_circle_check_items")
      .update({ sort_order: tmp })
      .eq("id", cur.id)
      .eq("facility_id", facility.facilityId)
    if (e1) return { ok: false, error: dbError(e1, "Failed to reorder.") }
    const { error: e2 } = await supabase
      .from("ice_operations_circle_check_items")
      .update({ sort_order: cur.sort_order })
      .eq("id", neighbor.id)
      .eq("facility_id", facility.facilityId)
    if (e2) return { ok: false, error: dbError(e2, "Failed to reorder.") }
    const { error: e3 } = await supabase
      .from("ice_operations_circle_check_items")
      .update({ sort_order: neighbor.sort_order })
      .eq("id", cur.id)
      .eq("facility_id", facility.facilityId)
    if (e3) return { ok: false, error: dbError(e3, "Failed to reorder.") }

    revalidatePath("/admin/ice-operations")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function bulkAddCircleCheckItems(
  lines: string[],
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const cleaned = lines
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => l.slice(0, 200))
    if (cleaned.length === 0) {
      return { ok: false, error: "Nothing to add." }
    }
    if (cleaned.length > CIRCLE_CHECK_BULK_CAP) {
      return {
        ok: false,
        error: `At most ${CIRCLE_CHECK_BULK_CAP} items can be added at once.`,
      }
    }

    const supabase = await createClient()

    // Enforce overall cap (existing + new <= CIRCLE_CHECK_BULK_CAP).
    const { count: existingCount, error: cntErr } = await supabase
      .from("ice_operations_circle_check_items")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", facility.facilityId)
    if (cntErr) {
      return { ok: false, error: dbError(cntErr, "Failed to count items.") }
    }
    const total = (existingCount ?? 0) + cleaned.length
    if (total > CIRCLE_CHECK_BULK_CAP) {
      return {
        ok: false,
        error: `Cap is ${CIRCLE_CHECK_BULK_CAP} items total; adding ${cleaned.length} would bring total to ${total}.`,
      }
    }

    const { data: maxRow } = await supabase
      .from("ice_operations_circle_check_items")
      .select("sort_order")
      .eq("facility_id", facility.facilityId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle()
    const baseSort = maxRow?.sort_order ?? 0

    const rows = cleaned.map((label, idx) => ({
      facility_id: facility.facilityId,
      label,
      sort_order: baseSort + idx + 1,
    }))

    const { error } = await supabase
      .from("ice_operations_circle_check_items")
      .insert(rows)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to bulk-add items.") }
    }
    revalidatePath("/admin/ice-operations")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Settings
// ============================================================================

export async function updateIceOperationsSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const tempRaw = nonEmpty(formData.get("temperature_unit")) ?? "F"
    if (!isTemperatureUnit(tempRaw)) {
      return { ok: false, error: "Invalid temperature unit." }
    }
    const temperature_unit: TemperatureUnit = tempRaw

    const alerts_enabled = formData.get("alerts_enabled") === "on"

    const sevRaw = nonEmpty(formData.get("default_alert_severity")) ?? "warn"
    if (!isSeverity(sevRaw)) {
      return { ok: false, error: "Invalid default severity." }
    }
    const default_alert_severity: Severity = sevRaw

    const supabase = await createClient()
    const { error } = await supabase.from("ice_operations_settings").upsert(
      {
        facility_id: facility.facilityId,
        temperature_unit,
        alerts_enabled,
        default_alert_severity,
      },
      { onConflict: "facility_id" },
    )
    if (error) {
      return { ok: false, error: dbError(error, "Failed to save settings.") }
    }
    revalidatePath("/admin/ice-operations")
    return { ok: true, message: "Settings saved." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Submissions / follow-up notes
// ============================================================================

export async function addIceOperationsFollowupNote(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const submission_id = nonEmpty(formData.get("submission_id"))
    if (!submission_id) return { ok: false, error: "Missing submission id." }
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

    const { error } = await supabase
      .from("ice_operations_followup_notes")
      .insert({
        facility_id: facility.facilityId,
        submission_id,
        employee_id,
        body,
        is_admin_note: true,
      })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to add note.") }
    }
    revalidatePath("/admin/ice-operations")
    return { ok: true, message: "Note added." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteIceOperationsSubmission(
  id: string,
): Promise<SimpleResult> {
  try {
    const current = await requireAdmin()
    if (!id) return { ok: false, error: "Missing submission id." }
    const supabase = await createClient()
    const facilityId = current.profile?.facility_id ?? null
    let query = supabase
      .from("ice_operations_submissions")
      .delete()
      .eq("id", id)
    if (facilityId) {
      query = query.eq("facility_id", facilityId)
    }
    const { error } = await query
    if (error) {
      // RLS will block non-super-admin (42501) — surface friendly message.
      return { ok: false, error: dbError(error, "Failed to delete submission.") }
    }
    revalidatePath("/admin/ice-operations")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Seed defaults
// ============================================================================

const DEFAULT_CIRCLE_CHECK_ITEMS: ReadonlyArray<{
  label: string
  applies_to_equipment_type: EquipmentType
  sort_order: number
}> = [
  {
    label: "Tires / wheels in good condition",
    applies_to_equipment_type: "zamboni",
    sort_order: 1,
  },
  {
    label: "Hydraulic fluid level OK",
    applies_to_equipment_type: "zamboni",
    sort_order: 2,
  },
  {
    label: "Conditioner blade sharp / undamaged",
    applies_to_equipment_type: "zamboni",
    sort_order: 3,
  },
  {
    label: "Brushes & towels clean",
    applies_to_equipment_type: "zamboni",
    sort_order: 4,
  },
  {
    label: "Edger blade secure & sharp",
    applies_to_equipment_type: "edger",
    sort_order: 5,
  },
]

export async function seedDefaultIceOperationsConfig(): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const supabase = await createClient()

    const { error: setErr } = await supabase
      .from("ice_operations_settings")
      .upsert(
        { facility_id: facility.facilityId },
        { onConflict: "facility_id", ignoreDuplicates: true },
      )
    if (setErr) {
      return { ok: false, error: dbError(setErr, "Failed to seed settings.") }
    }

    // Idempotent-ish: only insert items if there are none yet for this facility.
    const { count, error: cntErr } = await supabase
      .from("ice_operations_circle_check_items")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", facility.facilityId)
    if (cntErr) {
      return { ok: false, error: dbError(cntErr, "Failed to seed items.") }
    }
    if ((count ?? 0) === 0) {
      const rows = DEFAULT_CIRCLE_CHECK_ITEMS.map((d) => ({
        facility_id: facility.facilityId,
        label: d.label,
        applies_to_equipment_type: d.applies_to_equipment_type,
        sort_order: d.sort_order,
        is_active: true,
      }))
      const { error: insErr } = await supabase
        .from("ice_operations_circle_check_items")
        .insert(rows)
      if (insErr) {
        return { ok: false, error: dbError(insErr, "Failed to seed items.") }
      }
    }

    revalidatePath("/admin/ice-operations")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}
