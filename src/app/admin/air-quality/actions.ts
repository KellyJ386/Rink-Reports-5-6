"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import type { ActionState, Severity, SimpleResult } from "./types"
import { isSeverity } from "./types"

type SupabaseError = { code?: string; message?: string } | null

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

function asBool(value: FormDataEntryValue | null): boolean {
  return value === "on" || value === "true" || value === "1"
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
// Locations
// ============================================================================

export async function createLocation(
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
    const { error } = await supabase.from("air_quality_locations").insert({
      facility_id: facility.facilityId,
      name,
      slug,
      sort_order,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to create location.") }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true, message: "Location created." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function updateLocation(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing location id." }
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
    const sort_order = asInt(formData.get("sort_order"))

    const supabase = await createClient()
    const { error } = await supabase
      .from("air_quality_locations")
      .update({
        name,
        slug,
        ...(sort_order !== null ? { sort_order } : {}),
      })
      .eq("id", id)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update location.") }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true, message: "Location updated." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function setLocationActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    if (!id) return { ok: false, error: "Missing location id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("air_quality_locations")
      .update({ is_active })
      .eq("id", id)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update location.") }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteLocation(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    if (!id) return { ok: false, error: "Missing location id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("air_quality_locations")
      .delete()
      .eq("id", id)
    if (error) {
      if (error.code === "23503") {
        return {
          ok: false,
          error: "Location in use; deactivate instead.",
        }
      }
      return { ok: false, error: dbError(error, "Failed to delete location.") }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
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

    const location_id = nonEmpty(formData.get("location_id"))
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
    const sort_order = asInt(formData.get("sort_order")) ?? 0
    const model = nonEmpty(formData.get("model"))
    const serial_number = nonEmpty(formData.get("serial_number"))

    const supabase = await createClient()
    const { error } = await supabase.from("air_quality_equipment").insert({
      facility_id: facility.facilityId,
      location_id: location_id ?? null,
      name,
      slug,
      sort_order,
      model,
      serial_number,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to create equipment.") }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true, message: "Equipment created." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function updateEquipment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
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
    const model = nonEmpty(formData.get("model"))
    const serial_number = nonEmpty(formData.get("serial_number"))

    const supabase = await createClient()
    const { error } = await supabase
      .from("air_quality_equipment")
      .update({
        name,
        slug,
        model,
        serial_number,
        ...(sort_order !== null ? { sort_order } : {}),
      })
      .eq("id", id)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update equipment.") }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true, message: "Equipment updated." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function setEquipmentActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    if (!id) return { ok: false, error: "Missing equipment id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("air_quality_equipment")
      .update({ is_active })
      .eq("id", id)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update equipment.") }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteEquipment(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    if (!id) return { ok: false, error: "Missing equipment id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("air_quality_equipment")
      .delete()
      .eq("id", id)
    if (error) {
      if (error.code === "23503") {
        return {
          ok: false,
          error: "Equipment in use; deactivate instead.",
        }
      }
      return { ok: false, error: dbError(error, "Failed to delete equipment.") }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// ============================================================================
// Reading types
// ============================================================================

export async function createReadingType(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const label = nonEmpty(formData.get("label"))
    if (!label) return { ok: false, error: "Label is required." }
    const rawKey = nonEmpty(formData.get("key"))
    const key = rawKey ?? keyify(label)
    if (!KEY_RE.test(key)) {
      return {
        ok: false,
        error:
          "Key must be lowercase letters, digits, and underscores (e.g. co_ppm).",
      }
    }
    const unit = nonEmpty(formData.get("unit"))
    if (!unit) return { ok: false, error: "Unit is required." }
    const decimals = asInt(formData.get("decimals")) ?? 0
    if (decimals < 0 || decimals > 6) {
      return { ok: false, error: "Decimals must be between 0 and 6." }
    }
    const sort_order = asInt(formData.get("sort_order")) ?? 0
    const is_required = asBool(formData.get("is_required"))

    const supabase = await createClient()
    const { error } = await supabase.from("air_quality_reading_types").insert({
      facility_id: facility.facilityId,
      key,
      label,
      unit,
      decimals,
      is_required,
      sort_order,
    })
    if (error) {
      return {
        ok: false,
        error: dbError(error, "Failed to create reading type."),
      }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true, message: "Reading type created." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function updateReadingType(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing reading type id." }

    const label = nonEmpty(formData.get("label"))
    if (!label) return { ok: false, error: "Label is required." }
    const rawKey = nonEmpty(formData.get("key"))
    const key = rawKey ?? keyify(label)
    if (!KEY_RE.test(key)) {
      return {
        ok: false,
        error:
          "Key must be lowercase letters, digits, and underscores (e.g. co_ppm).",
      }
    }
    const unit = nonEmpty(formData.get("unit"))
    if (!unit) return { ok: false, error: "Unit is required." }
    const decimals = asInt(formData.get("decimals")) ?? 0
    if (decimals < 0 || decimals > 6) {
      return { ok: false, error: "Decimals must be between 0 and 6." }
    }
    const sort_order = asInt(formData.get("sort_order"))
    const is_required = asBool(formData.get("is_required"))

    const supabase = await createClient()
    const { error } = await supabase
      .from("air_quality_reading_types")
      .update({
        key,
        label,
        unit,
        decimals,
        is_required,
        ...(sort_order !== null ? { sort_order } : {}),
      })
      .eq("id", id)
    if (error) {
      return {
        ok: false,
        error: dbError(error, "Failed to update reading type."),
      }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true, message: "Reading type updated." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function setReadingTypeActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    if (!id) return { ok: false, error: "Missing reading type id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("air_quality_reading_types")
      .update({ is_active })
      .eq("id", id)
    if (error) {
      return {
        ok: false,
        error: dbError(error, "Failed to update reading type."),
      }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteReadingType(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    if (!id) return { ok: false, error: "Missing reading type id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("air_quality_reading_types")
      .delete()
      .eq("id", id)
    if (error) {
      if (error.code === "23503") {
        return {
          ok: false,
          error: "Reading type in use by submitted reports; deactivate instead.",
        }
      }
      return {
        ok: false,
        error: dbError(error, "Failed to delete reading type."),
      }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

/**
 * Swap sort_order with the previous/next reading type. -1 = up, +1 = down.
 * Uses the temp-negative trick to avoid any unique constraint collisions.
 */
export async function moveReadingType(
  id: string,
  direction: -1 | 1,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    if (!id) return { ok: false, error: "Missing reading type id." }
    const supabase = await createClient()

    const { data: cur, error: curErr } = await supabase
      .from("air_quality_reading_types")
      .select("id, facility_id, sort_order")
      .eq("id", id)
      .maybeSingle()
    if (curErr || !cur) {
      return { ok: false, error: dbError(curErr, "Reading type not found.") }
    }

    const neighborQuery = supabase
      .from("air_quality_reading_types")
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
      .from("air_quality_reading_types")
      .update({ sort_order: tmp })
      .eq("id", cur.id)
    if (e1) return { ok: false, error: dbError(e1, "Failed to reorder.") }
    const { error: e2 } = await supabase
      .from("air_quality_reading_types")
      .update({ sort_order: cur.sort_order })
      .eq("id", neighbor.id)
    if (e2) return { ok: false, error: dbError(e2, "Failed to reorder.") }
    const { error: e3 } = await supabase
      .from("air_quality_reading_types")
      .update({ sort_order: neighbor.sort_order })
      .eq("id", cur.id)
    if (e3) return { ok: false, error: dbError(e3, "Failed to reorder.") }

    revalidatePath("/admin/air-quality")
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// ============================================================================
// Thresholds
// ============================================================================

type ThresholdInputs = {
  warn_min: number | null
  warn_max: number | null
  alert_min: number | null
  alert_max: number | null
  compliance_min: number | null
  compliance_max: number | null
}

function readThresholdInputs(formData: FormData): ThresholdInputs {
  return {
    warn_min: asNumber(formData.get("warn_min")),
    warn_max: asNumber(formData.get("warn_max")),
    alert_min: asNumber(formData.get("alert_min")),
    alert_max: asNumber(formData.get("alert_max")),
    compliance_min: asNumber(formData.get("compliance_min")),
    compliance_max: asNumber(formData.get("compliance_max")),
  }
}

function validateThreshold(t: ThresholdInputs): string | null {
  const all = [
    t.warn_min,
    t.warn_max,
    t.alert_min,
    t.alert_max,
    t.compliance_min,
    t.compliance_max,
  ]
  if (all.every((v) => v === null)) {
    return "At least one threshold value is required."
  }
  const pairs: Array<[number | null, number | null, string]> = [
    [t.warn_min, t.warn_max, "Warn"],
    [t.alert_min, t.alert_max, "Alert"],
    [t.compliance_min, t.compliance_max, "Compliance"],
  ]
  for (const [min, max, label] of pairs) {
    if (min !== null && max !== null && min > max) {
      return `${label} min must be less than or equal to ${label} max.`
    }
  }
  return null
}

export async function createThreshold(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const reading_type_id = nonEmpty(formData.get("reading_type_id"))
    if (!reading_type_id)
      return { ok: false, error: "Reading type is required." }
    const location_id = nonEmpty(formData.get("location_id"))

    const inputs = readThresholdInputs(formData)
    const err = validateThreshold(inputs)
    if (err) return { ok: false, error: err }

    const sevRaw = nonEmpty(formData.get("severity")) ?? "warn"
    if (!isSeverity(sevRaw)) {
      return { ok: false, error: "Invalid severity." }
    }
    const severity: Severity = sevRaw

    const supabase = await createClient()
    const { error } = await supabase.from("air_quality_thresholds").insert({
      facility_id: facility.facilityId,
      reading_type_id,
      location_id: location_id ?? null,
      severity,
      ...inputs,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to create threshold.") }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true, message: "Threshold created." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function updateThreshold(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing threshold id." }

    const inputs = readThresholdInputs(formData)
    const err = validateThreshold(inputs)
    if (err) return { ok: false, error: err }

    const sevRaw = nonEmpty(formData.get("severity")) ?? "warn"
    if (!isSeverity(sevRaw)) {
      return { ok: false, error: "Invalid severity." }
    }
    const severity: Severity = sevRaw

    const supabase = await createClient()
    const { error } = await supabase
      .from("air_quality_thresholds")
      .update({
        severity,
        ...inputs,
      })
      .eq("id", id)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update threshold.") }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true, message: "Threshold updated." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function setThresholdActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    if (!id) return { ok: false, error: "Missing threshold id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("air_quality_thresholds")
      .update({ is_active })
      .eq("id", id)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update threshold.") }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteThreshold(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    if (!id) return { ok: false, error: "Missing threshold id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("air_quality_thresholds")
      .delete()
      .eq("id", id)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to delete threshold.") }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// ============================================================================
// Compliance rules
// ============================================================================

export async function createComplianceRule(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const jurisdiction = nonEmpty(formData.get("jurisdiction"))
    if (!jurisdiction) return { ok: false, error: "Jurisdiction is required." }
    const rule_name = nonEmpty(formData.get("rule_name"))
    if (!rule_name) return { ok: false, error: "Rule name is required." }
    const rule_body = nonEmpty(formData.get("rule_body"))
    if (!rule_body) return { ok: false, error: "Rule body is required." }
    const effective_from = nonEmpty(formData.get("effective_from"))
    const effective_to = nonEmpty(formData.get("effective_to"))
    const sort_order = asInt(formData.get("sort_order")) ?? 0

    const supabase = await createClient()
    const { error } = await supabase
      .from("air_quality_compliance_rules")
      .insert({
        facility_id: facility.facilityId,
        jurisdiction,
        rule_name,
        rule_body,
        effective_from,
        effective_to,
        sort_order,
      })
    if (error) {
      return {
        ok: false,
        error: dbError(error, "Failed to create compliance rule."),
      }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true, message: "Compliance rule created." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function updateComplianceRule(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing rule id." }
    const jurisdiction = nonEmpty(formData.get("jurisdiction"))
    if (!jurisdiction) return { ok: false, error: "Jurisdiction is required." }
    const rule_name = nonEmpty(formData.get("rule_name"))
    if (!rule_name) return { ok: false, error: "Rule name is required." }
    const rule_body = nonEmpty(formData.get("rule_body"))
    if (!rule_body) return { ok: false, error: "Rule body is required." }
    const effective_from = nonEmpty(formData.get("effective_from"))
    const effective_to = nonEmpty(formData.get("effective_to"))
    const sort_order = asInt(formData.get("sort_order"))

    const supabase = await createClient()
    const { error } = await supabase
      .from("air_quality_compliance_rules")
      .update({
        jurisdiction,
        rule_name,
        rule_body,
        effective_from,
        effective_to,
        ...(sort_order !== null ? { sort_order } : {}),
      })
      .eq("id", id)
    if (error) {
      return {
        ok: false,
        error: dbError(error, "Failed to update compliance rule."),
      }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true, message: "Compliance rule updated." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function setComplianceRuleActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    if (!id) return { ok: false, error: "Missing rule id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("air_quality_compliance_rules")
      .update({ is_active })
      .eq("id", id)
    if (error) {
      return {
        ok: false,
        error: dbError(error, "Failed to update compliance rule."),
      }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteComplianceRule(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    if (!id) return { ok: false, error: "Missing rule id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("air_quality_compliance_rules")
      .delete()
      .eq("id", id)
    if (error) {
      return {
        ok: false,
        error: dbError(error, "Failed to delete compliance rule."),
      }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// ============================================================================
// Reports + follow-up notes (append-only per RLS)
// ============================================================================

export async function addAirQualityFollowupNote(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
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
      .from("air_quality_followup_notes")
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
    revalidatePath("/admin/air-quality")
    return { ok: true, message: "Note added." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteAirQualityReport(
  reportId: string,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    if (!reportId) return { ok: false, error: "Missing report id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("air_quality_reports")
      .delete()
      .eq("id", reportId)
    if (error) {
      // RLS will block non-super-admin with a 42501 / permission denied.
      return { ok: false, error: dbError(error, "Failed to delete report.") }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// ============================================================================
// Settings
// ============================================================================

export async function updateAirQualitySettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const alerts_enabled = formData.get("alerts_enabled") === "on"
    const sevRaw = nonEmpty(formData.get("default_alert_severity")) ?? "warn"
    if (!isSeverity(sevRaw)) {
      return { ok: false, error: "Invalid default severity." }
    }
    const default_alert_severity: Severity = sevRaw
    const testing_frequency = nonEmpty(formData.get("testing_frequency"))
    const default_jurisdiction = nonEmpty(formData.get("default_jurisdiction"))

    const supabase = await createClient()
    const { error } = await supabase.from("air_quality_settings").upsert(
      {
        facility_id: facility.facilityId,
        alerts_enabled,
        default_alert_severity,
        testing_frequency,
        default_jurisdiction,
      },
      { onConflict: "facility_id" },
    )
    if (error) {
      return { ok: false, error: dbError(error, "Failed to save settings.") }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true, message: "Settings saved." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// ============================================================================
// Seed defaults
//
// The DB has a SECURITY DEFINER `seed_default_air_quality_config(uuid)`
// function but it is service_role-only, so we replicate the inserts inline so
// the call works under the admin's session. Idempotent via unique
// constraints on reading_types(facility_id, key) and the partial-unique
// indexes on thresholds, plus settings is upserted on facility_id.
// ============================================================================

const DEFAULT_READING_TYPES: ReadonlyArray<{
  key: string
  label: string
  unit: string
  decimals: number
  is_required: boolean
  sort_order: number
  threshold: {
    alert_max: number
    compliance_max: number
    severity: Severity
  }
}> = [
  {
    key: "co_ppm",
    label: "Carbon Monoxide (CO)",
    unit: "ppm",
    decimals: 1,
    is_required: true,
    sort_order: 1,
    threshold: { alert_max: 25, compliance_max: 50, severity: "high" },
  },
  {
    key: "co2_ppm",
    label: "Carbon Dioxide (CO2)",
    unit: "ppm",
    decimals: 0,
    is_required: true,
    sort_order: 2,
    threshold: { alert_max: 1000, compliance_max: 5000, severity: "warn" },
  },
]

export async function seedDefaultAirQualityConfig(): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const supabase = await createClient()

    // 1) Reading types — upsert by (facility_id, key).
    const rtRows = DEFAULT_READING_TYPES.map((rt) => ({
      facility_id: facility.facilityId,
      key: rt.key,
      label: rt.label,
      unit: rt.unit,
      decimals: rt.decimals,
      is_required: rt.is_required,
      sort_order: rt.sort_order,
      is_active: true,
    }))
    const { error: rtErr } = await supabase
      .from("air_quality_reading_types")
      .upsert(rtRows, {
        onConflict: "facility_id,key",
        ignoreDuplicates: true,
      })
    if (rtErr) {
      return {
        ok: false,
        error: dbError(rtErr, "Failed to seed reading types."),
      }
    }

    // 2) Re-fetch reading types so we have IDs for thresholds.
    const { data: existingRts, error: rtFetchErr } = await supabase
      .from("air_quality_reading_types")
      .select("id, key")
      .eq("facility_id", facility.facilityId)
    if (rtFetchErr) {
      return {
        ok: false,
        error: dbError(rtFetchErr, "Failed to read reading types."),
      }
    }
    const rtByKey = new Map(
      (existingRts ?? []).map((r) => [r.key, r.id as string]),
    )

    // 3) Thresholds — only insert if a default (location_id IS NULL, active)
    // doesn't already exist for that reading type.
    for (const rt of DEFAULT_READING_TYPES) {
      const readingTypeId = rtByKey.get(rt.key)
      if (!readingTypeId) continue
      const { data: existing, error: exErr } = await supabase
        .from("air_quality_thresholds")
        .select("id")
        .eq("facility_id", facility.facilityId)
        .eq("reading_type_id", readingTypeId)
        .is("location_id", null)
        .eq("is_active", true)
        .maybeSingle()
      if (exErr) {
        return {
          ok: false,
          error: dbError(exErr, "Failed to check thresholds."),
        }
      }
      if (existing) continue
      const { error: thErr } = await supabase
        .from("air_quality_thresholds")
        .insert({
          facility_id: facility.facilityId,
          reading_type_id: readingTypeId,
          location_id: null,
          alert_max: rt.threshold.alert_max,
          compliance_max: rt.threshold.compliance_max,
          severity: rt.threshold.severity,
          is_active: true,
        })
      if (thErr) {
        return {
          ok: false,
          error: dbError(thErr, "Failed to seed thresholds."),
        }
      }
    }

    // 4) Settings — upsert one row.
    const { error: setErr } = await supabase.from("air_quality_settings").upsert(
      {
        facility_id: facility.facilityId,
        alerts_enabled: true,
        default_jurisdiction: "us_federal",
        default_alert_severity: "warn",
      },
      { onConflict: "facility_id", ignoreDuplicates: true },
    )
    if (setErr) {
      return { ok: false, error: dbError(setErr, "Failed to seed settings.") }
    }

    revalidatePath("/admin/air-quality")
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}
