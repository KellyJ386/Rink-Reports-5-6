"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import type { Json } from "@/types/database"
import type { ImportResult, ValidatedRow } from "@/components/admin/bulk-upload"
import { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/observability/log-server-error"
import { dbError } from "@/lib/db-error"

import {
  readingTypeImportSpec,
  type ReadingTypeImportRow,
} from "./_components/reading-types-import"
import type { ActionState, Severity, SimpleResult } from "./types"
import { isSeverity } from "./types"
import {
  TIER_LEVELS,
  parseMetrics,
  parseTiers,
  validateOverrides,
  type ProfileTiers,
} from "@/app/reports/air-quality/_lib/compliance"

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
// Locations are managed via the shared Facility Spaces admin (/admin/spaces).
// Air Quality only consumes facility_spaces (migration 143); equipment and
// thresholds below are scoped to a space.
// ============================================================================

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
    logServerError("admin/air-quality/actions", e)
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
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update equipment.") }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true, message: "Equipment updated." }
  } catch (e) {
    logServerError("admin/air-quality/actions", e)
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
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing equipment id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("air_quality_equipment")
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update equipment.") }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true }
  } catch (e) {
    logServerError("admin/air-quality/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
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
      .from("air_quality_equipment")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
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
    logServerError("admin/air-quality/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// ============================================================================
// Reading types
// ============================================================================

export async function importReadingTypes(
  rows: ValidatedRow[],
): Promise<ImportResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, error: "No rows to import." }
    }

    // Re-validate every row server-side; never trust the client payload.
    const parsed: ReadingTypeImportRow[] = []
    const seen = new Set<string>()
    for (const r of rows) {
      const res = readingTypeImportSpec.zodRow.safeParse(r?.values)
      if (!res.success) {
        return {
          ok: false,
          error: `Row ${r?.rowNumber ?? "?"} failed validation.`,
        }
      }
      const row = res.data as ReadingTypeImportRow
      if (seen.has(row.key)) {
        return { ok: false, error: `Duplicate key "${row.key}" in the file.` }
      }
      seen.add(row.key)
      parsed.push(row)
    }

    const supabase = await createClient()
    const { data: maxRow } = await supabase
      .from("air_quality_reading_types")
      .select("sort_order")
      .eq("facility_id", facility.facilityId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle()
    const start = (maxRow?.sort_order ?? -1) + 1

    const insertRows = parsed.map((row, i) => ({
      facility_id: facility.facilityId,
      key: row.key,
      label: row.label,
      unit: row.unit,
      decimals: row.decimals,
      is_required: row.is_required,
      sort_order: start + i,
    }))

    const { error } = await supabase
      .from("air_quality_reading_types")
      .insert(insertRows)
    if (error) {
      if (error.code === "23505") {
        return {
          ok: false,
          error: "One or more keys already exist for this facility.",
        }
      }
      return { ok: false, error: dbError(error, "Failed to import reading types.") }
    }
    revalidatePath("/admin/air-quality")
    return {
      ok: true,
      inserted: insertRows.length,
      message: `Imported ${insertRows.length} reading type(s).`,
    }
  } catch (e) {
    logServerError("admin/air-quality/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

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
    logServerError("admin/air-quality/actions", e)
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
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
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
      .eq("facility_id", facility.facilityId)
    if (error) {
      return {
        ok: false,
        error: dbError(error, "Failed to update reading type."),
      }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true, message: "Reading type updated." }
  } catch (e) {
    logServerError("admin/air-quality/actions", e)
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
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing reading type id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("air_quality_reading_types")
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return {
        ok: false,
        error: dbError(error, "Failed to update reading type."),
      }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true }
  } catch (e) {
    logServerError("admin/air-quality/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteReadingType(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing reading type id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("air_quality_reading_types")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
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
    logServerError("admin/air-quality/actions", e)
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
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing reading type id." }
    const supabase = await createClient()

    const { data: cur, error: curErr } = await supabase
      .from("air_quality_reading_types")
      .select("id, facility_id, sort_order")
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
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
      .eq("facility_id", facility.facilityId)
    if (e1) return { ok: false, error: dbError(e1, "Failed to reorder.") }
    const { error: e2 } = await supabase
      .from("air_quality_reading_types")
      .update({ sort_order: cur.sort_order })
      .eq("id", neighbor.id)
      .eq("facility_id", facility.facilityId)
    if (e2) return { ok: false, error: dbError(e2, "Failed to reorder.") }
    const { error: e3 } = await supabase
      .from("air_quality_reading_types")
      .update({ sort_order: neighbor.sort_order })
      .eq("id", cur.id)
      .eq("facility_id", facility.facilityId)
    if (e3) return { ok: false, error: dbError(e3, "Failed to reorder.") }

    revalidatePath("/admin/air-quality")
    return { ok: true }
  } catch (e) {
    logServerError("admin/air-quality/actions", e)
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
    logServerError("admin/air-quality/actions", e)
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
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
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
      .eq("facility_id", facility.facilityId)
    if (error) {
      return {
        ok: false,
        error: dbError(error, "Failed to update compliance rule."),
      }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true, message: "Compliance rule updated." }
  } catch (e) {
    logServerError("admin/air-quality/actions", e)
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
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing rule id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("air_quality_compliance_rules")
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return {
        ok: false,
        error: dbError(error, "Failed to update compliance rule."),
      }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true }
  } catch (e) {
    logServerError("admin/air-quality/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteComplianceRule(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing rule id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("air_quality_compliance_rules")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return {
        ok: false,
        error: dbError(error, "Failed to delete compliance rule."),
      }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true }
  } catch (e) {
    logServerError("admin/air-quality/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// ============================================================================
// Compliance profile config (jurisdiction-aware engine; migrations 146/147)
// ============================================================================

export async function saveComplianceProfileConfig(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const supabase = await createClient()
    const profileId = nonEmpty(formData.get("compliance_profile_id"))

    // No profile selected → clear the facility's selection.
    if (!profileId) {
      const { error } = await supabase
        .from("facility_air_quality_config")
        .upsert(
          {
            facility_id: facility.facilityId,
            compliance_profile_id: null,
          },
          { onConflict: "facility_id" },
        )
      if (error) {
        return { ok: false, error: dbError(error, "Failed to save config.") }
      }
      revalidatePath("/admin/air-quality")
      return { ok: true, message: "Compliance profile cleared." }
    }

    // Load the chosen profile to validate metrics + overrides against it.
    const { data: profile, error: profErr } = await supabase
      .from("air_quality_compliance_profiles")
      .select("id, metrics, tiers")
      .eq("id", profileId)
      .maybeSingle()
    if (profErr) {
      return { ok: false, error: dbError(profErr, "Failed to load profile.") }
    }
    if (!profile) return { ok: false, error: "Selected profile not found." }

    const profileMetrics = parseMetrics(profile.metrics)
    const profileTiers = parseTiers(profile.tiers)
    const profileMetricKeys = new Set(profileMetrics.map((m) => m.key))

    // Active metrics: only keys that exist on the profile.
    const activeMetrics = formData
      .getAll("active_metrics")
      .filter((v): v is string => typeof v === "string")
      .filter((k) => profileMetricKeys.has(k))
    if (activeMetrics.length === 0) {
      return { ok: false, error: "Select at least one metric to track." }
    }

    // Stricter-only overrides: read override_<metric>_<tier> numeric ceilings.
    const overrides: ProfileTiers = {}
    for (const metric of profileMetrics) {
      for (const tier of TIER_LEVELS) {
        const raw = asNumber(formData.get(`override_${metric.key}_${tier}`))
        if (raw === null) continue
        overrides[metric.key] = overrides[metric.key] ?? {}
        overrides[metric.key][tier] = { max: raw, consecutive: null }
      }
    }
    const overrideErrors = validateOverrides(profileTiers, overrides)
    if (overrideErrors.length > 0) {
      return { ok: false, error: overrideErrors[0].message }
    }

    // Per-tier escalation steps/contacts (free text). Consumed by the reading
    // form's alert banners.
    const escalationConfig: Record<string, string> = {}
    for (const tier of TIER_LEVELS) {
      const text = nonEmpty(formData.get(`escalation_${tier}`))
      if (text) escalationConfig[tier] = text
    }

    // Optional role gates (advisory; per-user access is still governed by
    // user_permissions). Stored as a normalized key list.
    const parseRoles = (raw: FormDataEntryValue | null): string[] =>
      (nonEmpty(raw) ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    const submitRoles = parseRoles(formData.get("submit_roles"))
    const viewRoles = parseRoles(formData.get("view_roles"))

    const { error } = await supabase
      .from("facility_air_quality_config")
      .upsert(
        {
          facility_id: facility.facilityId,
          compliance_profile_id: profileId,
          active_metrics: activeMetrics,
          threshold_overrides: overrides as unknown as Json,
          escalation_config: escalationConfig as unknown as Json,
          submit_roles: submitRoles,
          view_roles: viewRoles,
        },
        { onConflict: "facility_id" },
      )
    if (error) {
      return { ok: false, error: dbError(error, "Failed to save config.") }
    }
    revalidatePath("/admin/air-quality")
    revalidatePath("/reports/air-quality")
    return { ok: true, message: "Compliance profile saved." }
  } catch (e) {
    logServerError("admin/air-quality/actions", e)
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
    logServerError("admin/air-quality/actions", e)
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
    const current = await requireAdmin()
    if (!reportId) return { ok: false, error: "Missing report id." }
    const supabase = await createClient()
    let query = supabase
      .from("air_quality_reports")
      .delete()
      .eq("id", reportId)
    // Non-super-admins must be facility-scoped (an explicit requirement, not
    // inferred from a null facility_id); super admins delete cross-facility by
    // intent. RLS backstops either path.
    if (!current.profile?.is_super_admin) {
      if (!current.profile?.facility_id) {
        return { ok: false, error: "No facility assigned to your account." }
      }
      query = query.eq("facility_id", current.profile.facility_id)
    }
    const { error } = await query
    if (error) {
      // RLS will block non-super-admin with a 42501 / permission denied.
      return { ok: false, error: dbError(error, "Failed to delete report.") }
    }
    revalidatePath("/admin/air-quality")
    return { ok: true }
  } catch (e) {
    logServerError("admin/air-quality/actions", e)
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
    logServerError("admin/air-quality/actions", e)
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

// Canonical ice-rink reading types. Threshold tiers are no longer seeded here —
// evaluation comes from the facility's compliance profile (migrations 146/147).
// CO is whole-ppm (decimals 0); NO2 is reported to one decimal. CO2 is retained
// as an optional building-air metric.
const DEFAULT_READING_TYPES: ReadonlyArray<{
  key: string
  label: string
  unit: string
  decimals: number
  is_required: boolean
  sort_order: number
}> = [
  {
    key: "co_ppm",
    label: "Carbon Monoxide (CO)",
    unit: "ppm",
    decimals: 0,
    is_required: true,
    sort_order: 1,
  },
  {
    key: "no2_ppm",
    label: "Nitrogen Dioxide (NO2)",
    unit: "ppm",
    decimals: 1,
    is_required: true,
    sort_order: 2,
  },
  {
    key: "co2_ppm",
    label: "Carbon Dioxide (CO2)",
    unit: "ppm",
    decimals: 0,
    is_required: false,
    sort_order: 3,
  },
]

// Human-readable required-action text seeded alongside the thresholds. Stored in
// air_quality_compliance_rules; the report form shows the rules whose
// `jurisdiction` matches the facility's settings.default_jurisdiction (MN below).
// The sustained/consecutive evacuation logic that the banded thresholds can't
// encode lives as structured JSON in a rule_body for a future engine pass.
const DEFAULT_COMPLIANCE_JURISDICTION = "MN"

const DEFAULT_COMPLIANCE_RULES: ReadonlyArray<{
  rule_name: string
  rule_body: string
  sort_order: number
}> = [
  {
    rule_name: "Acceptable air quality",
    rule_body:
      "CO <= 20 ppm and NO2 <= 0.3 ppm (one-hour average). Maintain whenever open to the public.",
    sort_order: 1,
  },
  {
    rule_name: "Correction (warn)",
    rule_body:
      "Any reading above acceptable: immediately increase ventilation; suspend internal-combustion equipment; retest every 20 min until acceptable; then test 20 min after each of the next 5 equipment uses; then >=1x/day for 3 days.",
    sort_order: 2,
  },
  {
    rule_name: "Evacuation (critical) — single sample",
    rule_body:
      "Evacuate immediately if CO > 83 ppm or NO2 > 2.0 ppm. Contact the local fire department; notify the state health department.",
    sort_order: 3,
  },
  {
    rule_name: "Evacuation (critical) — sustained [engine/v2]",
    rule_body:
      '{"sustained":[{"co":40,"minutes":60},{"co":20,"minutes":120},{"no2":0.6,"minutes":60},{"no2":0.3,"minutes":120}]}',
    sort_order: 4,
  },
  {
    rule_name: "Reoccupancy",
    rule_body:
      "Re-occupy only after acceptable readings are confirmed, corrective measures have been taken, and fire/health verification is complete.",
    sort_order: 5,
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

    // 2) Settings — upsert one row.
    const { error: setErr } = await supabase.from("air_quality_settings").upsert(
      {
        facility_id: facility.facilityId,
        alerts_enabled: true,
        default_jurisdiction: DEFAULT_COMPLIANCE_JURISDICTION,
        default_alert_severity: "warn",
      },
      { onConflict: "facility_id", ignoreDuplicates: true },
    )
    if (setErr) {
      return { ok: false, error: dbError(setErr, "Failed to seed settings.") }
    }

    // 5) Compliance rules — only seed if the facility has none yet, so an
    // admin's own edits are never clobbered on a re-seed.
    const { data: existingRules, error: ruleCheckErr } = await supabase
      .from("air_quality_compliance_rules")
      .select("id")
      .eq("facility_id", facility.facilityId)
      .limit(1)
    if (ruleCheckErr) {
      return {
        ok: false,
        error: dbError(ruleCheckErr, "Failed to check compliance rules."),
      }
    }
    if (!existingRules || existingRules.length === 0) {
      const ruleRows = DEFAULT_COMPLIANCE_RULES.map((r) => ({
        facility_id: facility.facilityId,
        jurisdiction: DEFAULT_COMPLIANCE_JURISDICTION,
        rule_name: r.rule_name,
        rule_body: r.rule_body,
        sort_order: r.sort_order,
        is_active: true,
      }))
      const { error: ruleErr } = await supabase
        .from("air_quality_compliance_rules")
        .insert(ruleRows)
      if (ruleErr) {
        return {
          ok: false,
          error: dbError(ruleErr, "Failed to seed compliance rules."),
        }
      }
    }

    revalidatePath("/admin/air-quality")
    return { ok: true }
  } catch (e) {
    logServerError("admin/air-quality/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}
