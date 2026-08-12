"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"
import { logServerError } from "@/lib/observability/log-server-error"
import { dbError } from "@/lib/db-error"
import {
  buildEditChangeLogEntries,
  planValueEdit,
  type FieldConfigRow as ComputeFieldConfigRow,
  type StoredValueRow,
  type ThresholdRow as ComputeThresholdRow,
} from "@/app/reports/refrigeration/_lib/compute"

import type {
  ActionState,
  FieldType,
  SelectOption,
  Severity,
  SimpleResult,
} from "./types"
import { isFieldType, isSeverity } from "./types"

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const KEY_RE = /^[a-z0-9]+(_[a-z0-9]+)*$/

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
}

function keyify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
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
 * Guard shared by every action in this module. requireAdmin() covers console
 * access (global admin / role fallback), but the refrigeration RLS write
 * policies gate on has_module_admin_access('refrigeration') — a module-scoped
 * user_permissions grant requireAdmin does NOT imply. Without this check, an
 * admin lacking the module grant reaches the action and the mutation dies at
 * the RLS layer with an opaque error (or is silently filtered to zero rows).
 * Returns a human-readable denial message, or null when allowed. (A message,
 * not a redirect: these actions run inside try/catch blocks that would
 * swallow the NEXT_REDIRECT control-flow error.)
 */
async function ensureRefrigerationAdmin(): Promise<string | null> {
  await requireAdmin()
  const supabase = await createClient()
  const allowed = await currentUserCan(supabase, "refrigeration", "admin")
  return allowed
    ? null
    : "Your account has admin console access but not the refrigeration module's admin permission. Ask an administrator to grant it under Admin → Permissions."
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

function parseSelectOptions(raw: string | null): SelectOption[] | null {
  if (!raw) return []
  // Lines like "key|Label" or just "Label" (key auto-derived).
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const out: SelectOption[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    let key: string
    let label: string
    if (line.includes("|")) {
      const [a, b] = line.split("|", 2)
      key = keyify(a ?? "")
      label = (b ?? "").trim()
    } else {
      label = line
      key = keyify(line)
    }
    if (!key || !label) return null
    if (seen.has(key)) return null
    seen.add(key)
    out.push({ key, label })
  }
  return out
}

// ============================================================================
// Sections
// ============================================================================

export async function createSection(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const denied = await ensureRefrigerationAdmin()
    if (denied) return { ok: false, error: denied }
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
          "Slug must be lowercase letters, digits, and hyphens (e.g. compressors).",
      }
    }
    const sort_order = asInt(formData.get("sort_order")) ?? 0

    const supabase = await createClient()
    const { error } = await supabase.from("refrigeration_sections").insert({
      facility_id: facility.facilityId,
      name,
      slug,
      sort_order,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to create section.") }
    }
    revalidatePath("/admin/refrigeration")
    return { ok: true, message: "Section created." }
  } catch (e) {
    logServerError("admin/refrigeration/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function updateSection(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const denied = await ensureRefrigerationAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing section id." }

    const name = nonEmpty(formData.get("name"))
    if (!name) return { ok: false, error: "Name is required." }
    const rawSlug = nonEmpty(formData.get("slug"))
    const slug = rawSlug ?? slugify(name)
    if (!SLUG_RE.test(slug)) {
      return {
        ok: false,
        error:
          "Slug must be lowercase letters, digits, and hyphens (e.g. compressors).",
      }
    }
    const sort_order = asInt(formData.get("sort_order"))

    const supabase = await createClient()
    // `.select()` makes a zero-row update detectable (RLS/permission denial or
    // a stale id returns no rows rather than silently succeeding).
    const { data, error } = await supabase
      .from("refrigeration_sections")
      .update({
        name,
        slug,
        ...(sort_order !== null ? { sort_order } : {}),
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("id")
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update section.") }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Section not found." }
    }
    revalidatePath("/admin/refrigeration")
    return { ok: true, message: "Section updated." }
  } catch (e) {
    logServerError("admin/refrigeration/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function setSectionActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    const denied = await ensureRefrigerationAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing section id." }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("refrigeration_sections")
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("id")
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update section.") }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Section not found." }
    }
    revalidatePath("/admin/refrigeration")
    return { ok: true }
  } catch (e) {
    logServerError("admin/refrigeration/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteSection(id: string): Promise<SimpleResult> {
  try {
    const denied = await ensureRefrigerationAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing section id." }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("refrigeration_sections")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("id")
    if (error) {
      if (error.code === "23503") {
        return {
          ok: false,
          error: "Section in use; deactivate instead.",
        }
      }
      return { ok: false, error: dbError(error, "Failed to delete section.") }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Section not found." }
    }
    revalidatePath("/admin/refrigeration")
    return { ok: true }
  } catch (e) {
    logServerError("admin/refrigeration/actions", e)
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
    const denied = await ensureRefrigerationAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const section_id = nonEmpty(formData.get("section_id"))
    if (!section_id) return { ok: false, error: "Section is required." }
    const name = nonEmpty(formData.get("name"))
    if (!name) return { ok: false, error: "Name is required." }
    const rawSlug = nonEmpty(formData.get("slug"))
    const slug = rawSlug ?? slugify(name)
    if (!SLUG_RE.test(slug)) {
      return {
        ok: false,
        error:
          "Slug must be lowercase letters, digits, and hyphens (e.g. compressor-1).",
      }
    }
    const sort_order = asInt(formData.get("sort_order")) ?? 0

    const supabase = await createClient()
    const { error } = await supabase.from("refrigeration_equipment").insert({
      facility_id: facility.facilityId,
      section_id,
      name,
      slug,
      sort_order,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to create equipment.") }
    }
    revalidatePath("/admin/refrigeration")
    return { ok: true, message: "Equipment created." }
  } catch (e) {
    logServerError("admin/refrigeration/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function updateEquipment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const denied = await ensureRefrigerationAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing equipment id." }
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
    const { data, error } = await supabase
      .from("refrigeration_equipment")
      .update({
        name,
        slug,
        ...(sort_order !== null ? { sort_order } : {}),
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("id")
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update equipment.") }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Equipment not found." }
    }
    revalidatePath("/admin/refrigeration")
    return { ok: true, message: "Equipment updated." }
  } catch (e) {
    logServerError("admin/refrigeration/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function setEquipmentActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    const denied = await ensureRefrigerationAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing equipment id." }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("refrigeration_equipment")
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("id")
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update equipment.") }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Equipment not found." }
    }
    revalidatePath("/admin/refrigeration")
    return { ok: true }
  } catch (e) {
    logServerError("admin/refrigeration/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteEquipment(id: string): Promise<SimpleResult> {
  try {
    const denied = await ensureRefrigerationAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing equipment id." }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("refrigeration_equipment")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("id")
    if (error) {
      if (error.code === "23503") {
        return {
          ok: false,
          error: "Equipment in use; deactivate instead.",
        }
      }
      return { ok: false, error: dbError(error, "Failed to delete equipment.") }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Equipment not found." }
    }
    revalidatePath("/admin/refrigeration")
    return { ok: true }
  } catch (e) {
    logServerError("admin/refrigeration/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Fields
// ============================================================================

export async function createField(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const denied = await ensureRefrigerationAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const section_id = nonEmpty(formData.get("section_id"))
    if (!section_id) return { ok: false, error: "Section is required." }
    const equipment_id = nonEmpty(formData.get("equipment_id"))
    const label = nonEmpty(formData.get("label"))
    if (!label) return { ok: false, error: "Label is required." }
    const rawKey = nonEmpty(formData.get("key"))
    const key = rawKey ?? keyify(label)
    if (!KEY_RE.test(key)) {
      return {
        ok: false,
        error:
          "Key must be lowercase letters, digits, and underscores (e.g. suction_psi).",
      }
    }
    const field_type_raw = nonEmpty(formData.get("field_type")) ?? ""
    if (!isFieldType(field_type_raw)) {
      return { ok: false, error: "Invalid field type." }
    }
    const field_type: FieldType = field_type_raw
    const unit = nonEmpty(formData.get("unit"))
    const sort_order = asInt(formData.get("sort_order")) ?? 0

    let options: SelectOption[] = []
    if (field_type === "select") {
      const raw = nonEmpty(formData.get("options"))
      const parsed = parseSelectOptions(raw)
      if (parsed === null) {
        return {
          ok: false,
          error:
            "Options must be one per line: either 'key|Label' or just 'Label'. Keys must be unique.",
        }
      }
      if (parsed.length === 0) {
        return { ok: false, error: "Select fields need at least one option." }
      }
      options = parsed
    }

    const supabase = await createClient()
    const { error } = await supabase.from("refrigeration_fields").insert({
      facility_id: facility.facilityId,
      section_id,
      equipment_id: equipment_id ?? null,
      label,
      key,
      field_type,
      unit,
      sort_order,
      options,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to create field.") }
    }
    revalidatePath("/admin/refrigeration")
    return { ok: true, message: "Field created." }
  } catch (e) {
    logServerError("admin/refrigeration/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function updateField(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const denied = await ensureRefrigerationAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing field id." }

    const label = nonEmpty(formData.get("label"))
    if (!label) return { ok: false, error: "Label is required." }
    const rawKey = nonEmpty(formData.get("key"))
    const key = rawKey ?? keyify(label)
    if (!KEY_RE.test(key)) {
      return {
        ok: false,
        error:
          "Key must be lowercase letters, digits, and underscores (e.g. suction_psi).",
      }
    }
    const field_type_raw = nonEmpty(formData.get("field_type")) ?? ""
    if (!isFieldType(field_type_raw)) {
      return { ok: false, error: "Invalid field type." }
    }
    const field_type: FieldType = field_type_raw
    const unit = nonEmpty(formData.get("unit"))
    const sort_order = asInt(formData.get("sort_order"))

    let options: SelectOption[] = []
    if (field_type === "select") {
      const raw = nonEmpty(formData.get("options"))
      const parsed = parseSelectOptions(raw)
      if (parsed === null) {
        return {
          ok: false,
          error:
            "Options must be one per line: either 'key|Label' or just 'Label'. Keys must be unique.",
        }
      }
      if (parsed.length === 0) {
        return { ok: false, error: "Select fields need at least one option." }
      }
      options = parsed
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("refrigeration_fields")
      .update({
        label,
        key,
        field_type,
        unit,
        ...(sort_order !== null ? { sort_order } : {}),
        options,
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("id")
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update field.") }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Field not found." }
    }
    revalidatePath("/admin/refrigeration")
    return { ok: true, message: "Field updated." }
  } catch (e) {
    logServerError("admin/refrigeration/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function setFieldActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    const denied = await ensureRefrigerationAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing field id." }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("refrigeration_fields")
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("id")
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update field.") }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Field not found." }
    }
    revalidatePath("/admin/refrigeration")
    return { ok: true }
  } catch (e) {
    logServerError("admin/refrigeration/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteField(id: string): Promise<SimpleResult> {
  try {
    const denied = await ensureRefrigerationAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing field id." }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("refrigeration_fields")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("id")
    if (error) {
      if (error.code === "23503") {
        return {
          ok: false,
          error: "Field in use by submitted reports; deactivate instead.",
        }
      }
      return { ok: false, error: dbError(error, "Failed to delete field.") }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Field not found." }
    }
    revalidatePath("/admin/refrigeration")
    return { ok: true }
  } catch (e) {
    logServerError("admin/refrigeration/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/**
 * Swap sort_order with the previous/next field in the same (section, equipment)
 * group. -1 = up, +1 = down. Uses the temp-negative trick to avoid any unique
 * constraint collisions.
 */
export async function moveField(
  id: string,
  direction: -1 | 1,
): Promise<SimpleResult> {
  try {
    const denied = await ensureRefrigerationAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing field id." }
    const supabase = await createClient()

    const { data: cur, error: curErr } = await supabase
      .from("refrigeration_fields")
      .select("id, section_id, equipment_id, sort_order")
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    if (curErr || !cur) {
      return { ok: false, error: dbError(curErr, "Field not found.") }
    }

    let neighborQuery = supabase
      .from("refrigeration_fields")
      .select("id, sort_order")
      .eq("section_id", cur.section_id)
      .neq("id", cur.id)
    neighborQuery =
      cur.equipment_id === null
        ? neighborQuery.is("equipment_id", null)
        : neighborQuery.eq("equipment_id", cur.equipment_id)

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
    const { data: d1, error: e1 } = await supabase
      .from("refrigeration_fields")
      .update({ sort_order: tmp })
      .eq("id", cur.id)
      .eq("facility_id", facility.facilityId)
      .select("id")
    if (e1) return { ok: false, error: dbError(e1, "Failed to reorder.") }
    if (!d1 || d1.length === 0) return { ok: false, error: "Field not found." }
    const { error: e2 } = await supabase
      .from("refrigeration_fields")
      .update({ sort_order: cur.sort_order })
      .eq("id", neighbor.id)
      .eq("facility_id", facility.facilityId)
    if (e2) return { ok: false, error: dbError(e2, "Failed to reorder.") }
    const { error: e3 } = await supabase
      .from("refrigeration_fields")
      .update({ sort_order: neighbor.sort_order })
      .eq("id", cur.id)
      .eq("facility_id", facility.facilityId)
    if (e3) return { ok: false, error: dbError(e3, "Failed to reorder.") }

    revalidatePath("/admin/refrigeration")
    return { ok: true }
  } catch (e) {
    logServerError("admin/refrigeration/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Thresholds
// ============================================================================

export async function createThreshold(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const denied = await ensureRefrigerationAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const field_id = nonEmpty(formData.get("field_id"))
    if (!field_id) return { ok: false, error: "Field is required." }
    const equipment_id = nonEmpty(formData.get("equipment_id"))
    const min_value = asNumber(formData.get("min_value"))
    const max_value = asNumber(formData.get("max_value"))
    if (min_value === null && max_value === null) {
      return { ok: false, error: "At least one of Min or Max is required." }
    }
    if (
      min_value !== null &&
      max_value !== null &&
      min_value > max_value
    ) {
      return {
        ok: false,
        error: "Min value must be less than or equal to Max value.",
      }
    }

    const sevRaw = nonEmpty(formData.get("severity")) ?? "warn"
    if (!isSeverity(sevRaw)) {
      return { ok: false, error: "Invalid severity." }
    }
    const severity: Severity = sevRaw

    const supabase = await createClient()
    const { error } = await supabase.from("refrigeration_thresholds").insert({
      facility_id: facility.facilityId,
      field_id,
      equipment_id: equipment_id ?? null,
      min_value,
      max_value,
      severity,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to create threshold.") }
    }
    revalidatePath("/admin/refrigeration")
    return { ok: true, message: "Threshold created." }
  } catch (e) {
    logServerError("admin/refrigeration/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function updateThreshold(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const denied = await ensureRefrigerationAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing threshold id." }

    const min_value = asNumber(formData.get("min_value"))
    const max_value = asNumber(formData.get("max_value"))
    if (min_value === null && max_value === null) {
      return { ok: false, error: "At least one of Min or Max is required." }
    }
    if (
      min_value !== null &&
      max_value !== null &&
      min_value > max_value
    ) {
      return {
        ok: false,
        error: "Min value must be less than or equal to Max value.",
      }
    }

    const sevRaw = nonEmpty(formData.get("severity")) ?? "warn"
    if (!isSeverity(sevRaw)) {
      return { ok: false, error: "Invalid severity." }
    }
    const severity: Severity = sevRaw

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("refrigeration_thresholds")
      .update({
        min_value,
        max_value,
        severity,
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("id")
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update threshold.") }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Threshold not found." }
    }
    revalidatePath("/admin/refrigeration")
    return { ok: true, message: "Threshold updated." }
  } catch (e) {
    logServerError("admin/refrigeration/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function setThresholdActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    const denied = await ensureRefrigerationAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing threshold id." }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("refrigeration_thresholds")
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("id")
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update threshold.") }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Threshold not found." }
    }
    revalidatePath("/admin/refrigeration")
    return { ok: true }
  } catch (e) {
    logServerError("admin/refrigeration/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteThreshold(id: string): Promise<SimpleResult> {
  try {
    const denied = await ensureRefrigerationAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing threshold id." }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("refrigeration_thresholds")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("id")
    if (error) {
      return { ok: false, error: dbError(error, "Failed to delete threshold.") }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Threshold not found." }
    }
    revalidatePath("/admin/refrigeration")
    return { ok: true }
  } catch (e) {
    logServerError("admin/refrigeration/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Reports + follow-up notes (append-only per RLS)
// ============================================================================

export async function addRefrigerationFollowupNote(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const denied = await ensureRefrigerationAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const report_id = nonEmpty(formData.get("report_id"))
    if (!report_id) return { ok: false, error: "Missing report id." }
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
      .from("refrigeration_followup_notes")
      .insert({
        facility_id: facility.facilityId,
        report_id,
        employee_id,
        body,
        is_admin_note: true,
      })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to add note.") }
    }
    revalidatePath("/admin/refrigeration")
    return { ok: true, message: "Note added." }
  } catch (e) {
    logServerError("admin/refrigeration/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteRefrigerationReport(
  reportId: string,
): Promise<SimpleResult> {
  try {
    const denied = await ensureRefrigerationAdmin()
    if (denied) return { ok: false, error: denied }
    const current = await requireAdmin()
    if (!reportId) return { ok: false, error: "Missing report id." }
    // The reports DELETE policy is super-admin-only. RLS does not error for
    // other callers — it silently filters the delete to zero rows — so check
    // up front rather than reporting a success that didn't happen.
    if (!current.profile?.is_super_admin) {
      return {
        ok: false,
        error: "Only a super admin can delete refrigeration reports.",
      }
    }
    const supabase = await createClient()
    const facilityId = current.profile?.facility_id ?? null
    let query = supabase
      .from("refrigeration_reports")
      .delete()
      .eq("id", reportId)
    if (facilityId) {
      query = query.eq("facility_id", facilityId)
    }
    const { data, error } = await query.select("id")
    if (error) {
      return { ok: false, error: dbError(error, "Failed to delete report.") }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Report not found." }
    }
    revalidatePath("/admin/refrigeration")
    return { ok: true }
  } catch (e) {
    logServerError("admin/refrigeration/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Settings
// ============================================================================

export async function updateRefrigerationSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const denied = await ensureRefrigerationAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const out_of_range_alerts_enabled =
      formData.get("out_of_range_alerts_enabled") === "on"
    const sevRaw = nonEmpty(formData.get("default_alert_severity")) ?? "warn"
    if (!isSeverity(sevRaw)) {
      return { ok: false, error: "Invalid default severity." }
    }
    const default_alert_severity: Severity = sevRaw

    // Optional cap on reading rounds per shift. Blank/absent ⇒ unlimited (null).
    const readings_per_shift = asInt(formData.get("readings_per_shift"))
    if (
      readings_per_shift !== null &&
      (readings_per_shift < 1 || readings_per_shift > 99)
    ) {
      return {
        ok: false,
        error: "Readings per shift must be between 1 and 99 (or blank for unlimited).",
      }
    }

    const supabase = await createClient()
    const { error } = await supabase
      .from("refrigeration_settings")
      .upsert(
        {
          facility_id: facility.facilityId,
          out_of_range_alerts_enabled,
          default_alert_severity,
          readings_per_shift,
        },
        { onConflict: "facility_id" },
      )
    if (error) {
      return { ok: false, error: dbError(error, "Failed to save settings.") }
    }
    revalidatePath("/admin/refrigeration")
    return { ok: true, message: "Settings saved." }
  } catch (e) {
    logServerError("admin/refrigeration/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Seed defaults
//
// The DB has a SECURITY DEFINER `seed_default_refrigeration_sections(uuid)`
// function but it is service_role-only, so we replicate the inserts inline so
// the call works under the admin's session. Idempotent via the unique
// (facility_id, slug) constraint on sections.
// ============================================================================

const DEFAULT_SECTIONS: ReadonlyArray<{
  name: string
  slug: string
  sort_order: number
}> = [
  { name: "Compressors", slug: "compressors", sort_order: 1 },
  { name: "Pumps", slug: "pumps", sort_order: 2 },
  { name: "Condensers", slug: "condensers", sort_order: 3 },
  { name: "Supply / Return", slug: "supply-return", sort_order: 4 },
  { name: "Machine Hours", slug: "machine-hours", sort_order: 5 },
  { name: "Alarms", slug: "alarms", sort_order: 6 },
]

export async function seedDefaultRefrigerationSections(): Promise<SimpleResult> {
  try {
    const denied = await ensureRefrigerationAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const supabase = await createClient()
    const rows = DEFAULT_SECTIONS.map((s) => ({
      facility_id: facility.facilityId,
      name: s.name,
      slug: s.slug,
      sort_order: s.sort_order,
      is_active: true,
    }))
    const { error: secErr } = await supabase
      .from("refrigeration_sections")
      .upsert(rows, {
        onConflict: "facility_id,slug",
        ignoreDuplicates: true,
      })
    if (secErr) {
      return { ok: false, error: dbError(secErr, "Failed to seed sections.") }
    }

    // Ensure a settings row exists for this facility (idempotent).
    const { error: setErr } = await supabase
      .from("refrigeration_settings")
      .upsert(
        {
          facility_id: facility.facilityId,
        },
        { onConflict: "facility_id", ignoreDuplicates: true },
      )
    if (setErr) {
      return { ok: false, error: dbError(setErr, "Failed to seed settings.") }
    }

    revalidatePath("/admin/refrigeration")
    return { ok: true }
  } catch (e) {
    logServerError("admin/refrigeration/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/**
 * Admin correction of a single NUMERIC reading on a submitted report.
 *
 * Applies the pure plan from planValueEdit: updates the edited value with
 * re-checked threshold flags, recomputes every active computed field in the
 * same section that depends on the edited field's key (updating or inserting
 * its value row), and records the whole correction in the append-only
 * refrigeration_change_log — one entry for the source edit (admin-supplied
 * reason) plus one per recomputed value ("recomputed: source value edited").
 *
 * Authorization is plain RLS (migration 238): report-value UPDATE requires
 * has_module_admin_access('refrigeration') within the caller's facility — no
 * SECURITY DEFINER involved. facility_id comes from the session profile,
 * never from the client.
 */
export async function updateRefrigerationReportValue(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const denied = await ensureRefrigerationAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const valueId = nonEmpty(formData.get("value_id"))
    if (!valueId) return { ok: false, error: "Missing value id." }
    const newValue = asNumber(formData.get("new_value"))
    if (newValue === null) return { ok: false, error: "Enter a valid number." }
    const reason = nonEmpty(formData.get("reason"))
    if (!reason) {
      return { ok: false, error: "A reason is required for corrections." }
    }

    const supabase = await createClient()

    // change_log.changed_by references employees (NOT NULL) — resolve the
    // acting admin's employee row up front so the audit trail can't be skipped.
    const current = await getCurrentUser()
    let changedBy: string | null = null
    if (current?.profile?.id) {
      const { data: emp } = await supabase
        .from("employees")
        .select("id")
        .eq("user_id", current.profile.id)
        .eq("facility_id", facility.facilityId)
        .eq("is_active", true)
        .maybeSingle()
      changedBy = emp?.id ?? null
    }
    if (!changedBy) {
      return {
        ok: false,
        error:
          "Your account has no active employee record in this facility, so the correction cannot be logged.",
      }
    }

    const VALUE_COLS =
      "id, report_id, field_id, equipment_id, label_snapshot, field_type_snapshot, unit_snapshot, value_numeric, is_out_of_range, threshold_id"

    const { data: editedRaw, error: loadErr } = await supabase
      .from("refrigeration_report_values")
      .select(VALUE_COLS)
      .eq("id", valueId)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    if (loadErr || !editedRaw) {
      return { ok: false, error: dbError(loadErr ?? null, "Reading not found.") }
    }

    const [{ data: siblingRaw }, { data: fieldsRaw }, { data: thresholdsRaw }] =
      await Promise.all([
        supabase
          .from("refrigeration_report_values")
          .select(VALUE_COLS)
          .eq("report_id", editedRaw.report_id)
          .eq("facility_id", facility.facilityId)
          .order("created_at", { ascending: true }),
        supabase
          .from("refrigeration_fields")
          .select(
            "id, section_id, equipment_id, key, label, unit, field_type, options",
          )
          .eq("facility_id", facility.facilityId)
          .eq("is_active", true),
        supabase
          .from("refrigeration_thresholds")
          .select("id, field_id, equipment_id, min_value, max_value, severity")
          .eq("facility_id", facility.facilityId)
          .eq("is_active", true),
      ])

    const planned = planValueEdit({
      editedRow: editedRaw as StoredValueRow,
      newValue,
      reportValues: (siblingRaw ?? []) as StoredValueRow[],
      fields: (fieldsRaw ?? []) as ComputeFieldConfigRow[],
      thresholds: (thresholdsRaw ?? []) as ComputeThresholdRow[],
    })
    if (!planned.ok) return { ok: false, error: planned.error }
    const { plan } = planned

    for (const s of plan.skipped) {
      console.warn(
        `refrigeration: skipping computed field "${s.field.key}" (${s.field.id}) during edit: ${s.reason}`,
      )
    }

    // 1) The corrected source reading. `.select()` makes an RLS-filtered
    // zero-row update detectable instead of a silent no-op.
    const { data: updatedRows, error: updErr } = await supabase
      .from("refrigeration_report_values")
      .update({
        value_numeric: plan.edited.value_numeric,
        is_out_of_range: plan.edited.is_out_of_range,
        threshold_id: plan.edited.threshold_id,
      })
      .eq("id", plan.edited.id)
      .eq("facility_id", facility.facilityId)
      .select("id")
    if (updErr || !updatedRows || updatedRows.length === 0) {
      return {
        ok: false,
        error: dbError(
          updErr ?? null,
          "Failed to update the reading (no matching row — check permissions).",
        ),
      }
    }

    // 2) Dependent computed values: update in place, or insert when the
    // computed row didn't exist yet (its inputs were incomplete at submit).
    for (const r of plan.recomputed) {
      if (r.id) {
        const { error: recompErr } = await supabase
          .from("refrigeration_report_values")
          .update({
            value_numeric: r.value_numeric,
            is_out_of_range: r.is_out_of_range,
            threshold_id: r.threshold_id,
          })
          .eq("id", r.id)
          .eq("facility_id", facility.facilityId)
        if (recompErr) {
          return {
            ok: false,
            error: dbError(recompErr, "Failed to recompute a dependent value."),
          }
        }
      } else {
        const { error: insErr } = await supabase
          .from("refrigeration_report_values")
          .insert({
            facility_id: facility.facilityId,
            report_id: editedRaw.report_id,
            field_id: r.field.id,
            equipment_id: r.field.equipment_id,
            label_snapshot: r.field.label,
            equipment_name_snapshot: null,
            field_type_snapshot: "computed",
            unit_snapshot: r.field.unit,
            value_text: null,
            value_numeric: r.value_numeric,
            value_boolean: null,
            is_out_of_range: r.is_out_of_range,
            threshold_id: r.threshold_id,
          })
        if (insErr) {
          return {
            ok: false,
            error: dbError(insErr, "Failed to store a recomputed value."),
          }
        }
      }
    }

    // 3) Append-only audit trail: the source edit + every recompute.
    const entries = buildEditChangeLogEntries(plan, {
      facilityId: facility.facilityId,
      reportId: editedRaw.report_id,
      changedBy,
      reason,
      editedLabel: editedRaw.label_snapshot,
    })
    const { error: logErr } = await supabase
      .from("refrigeration_change_log")
      .insert(entries)
    if (logErr) {
      return {
        ok: false,
        error: dbError(logErr, "Value updated but logging the change failed."),
      }
    }

    revalidatePath("/admin/refrigeration")
    const n = plan.recomputed.length
    return {
      ok: true,
      message:
        n > 0
          ? `Reading corrected; ${n} computed value${n === 1 ? "" : "s"} recalculated.`
          : "Reading corrected.",
    }
  } catch (e) {
    logServerError("admin/refrigeration/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}
