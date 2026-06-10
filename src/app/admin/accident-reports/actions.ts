"use server"

import { revalidatePath, updateTag } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { accidentDropdownsTag } from "@/app/reports/accidents/_lib/dropdowns"
import type { ImportResult, ValidatedRow } from "@/components/admin/bulk-upload"
import { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/observability/log-server-error"
import type { Json } from "@/types/database"

import {
  dropdownsImportSpec,
  type AccidentDropdownImportRow,
} from "./_components/dropdowns-import"
import type { ActionState, DropdownCategory, SimpleResult } from "./types"
import { DROPDOWN_CATEGORIES, isDropdownCategory } from "./types"

type SupabaseError = { code?: string; message?: string } | null

const KEY_RE = /^[a-z0-9_]+$/

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

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  if (err.code === "23505") {
    return "A dropdown with that key already exists in this category."
  }
  if (err.code === "23503") {
    return "Cannot complete: a related record prevents this change."
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
// Dropdowns
// ============================================================================

function buildMetadata(
  category: DropdownCategory,
  formData: FormData,
): Json {
  if (category === "medical_attention") {
    const triggers = formData.get("triggers_alert") === "on"
    return triggers ? { triggers_alert: true } : {}
  }
  return {}
}

export async function importDropdowns(
  rows: ValidatedRow[],
): Promise<ImportResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, error: "No rows to import." }
    }

    // Re-validate server-side; never trust the client payload.
    const parsed: AccidentDropdownImportRow[] = []
    const seen = new Set<string>()
    for (const r of rows) {
      const res = dropdownsImportSpec.zodRow.safeParse(r?.values)
      if (!res.success) {
        return {
          ok: false,
          error: `Row ${r?.rowNumber ?? "?"} failed validation.`,
        }
      }
      const row = res.data as AccidentDropdownImportRow
      const dedupeKey = `${row.category}:${row.key}`
      if (seen.has(dedupeKey)) {
        return {
          ok: false,
          error: `Duplicate ${row.category} key "${row.key}" in the file.`,
        }
      }
      seen.add(dedupeKey)
      parsed.push(row)
    }

    const supabase = await createClient()

    // Next sort_order per category present in the batch (append to the end).
    const categories = Array.from(new Set(parsed.map((r) => r.category)))
    const nextByCategory = new Map<string, number>()
    for (const cat of categories) {
      const { data: maxRow } = await supabase
        .from("accident_dropdowns")
        .select("sort_order")
        .eq("facility_id", facility.facilityId)
        .eq("category", cat)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle()
      nextByCategory.set(cat, (maxRow?.sort_order ?? 0) + 1)
    }

    const insertRows = parsed.map((row) => {
      const so = nextByCategory.get(row.category) ?? 1
      nextByCategory.set(row.category, so + 1)
      const metadata: Json =
        row.category === "medical_attention" && row.triggers_alert
          ? { triggers_alert: true }
          : {}
      return {
        facility_id: facility.facilityId,
        category: row.category,
        key: row.key,
        display_name: row.display_name,
        color: row.color ?? null,
        sort_order: so,
        metadata,
        is_active: row.is_active,
      }
    })

    const { error } = await supabase
      .from("accident_dropdowns")
      .insert(insertRows)
    if (error) {
      if (error.code === "23505") {
        return {
          ok: false,
          error: "One or more (category, key) pairs already exist.",
        }
      }
      return { ok: false, error: dbError(error, "Failed to import dropdowns.") }
    }
    revalidatePath("/admin/accident-reports")
    updateTag(accidentDropdownsTag(facility.facilityId))
    return {
      ok: true,
      inserted: insertRows.length,
      message: `Imported ${insertRows.length} value(s).`,
    }
  } catch (e) {
    logServerError("admin/accident-reports/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function createDropdown(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const rawCategory = nonEmpty(formData.get("category"))
    if (!rawCategory || !isDropdownCategory(rawCategory)) {
      return { ok: false, error: "Invalid category." }
    }
    const category: DropdownCategory = rawCategory

    const key = nonEmpty(formData.get("key"))
    if (!key) return { ok: false, error: "Key is required." }
    if (!KEY_RE.test(key)) {
      return {
        ok: false,
        error:
          "Key must be lowercase letters, digits, and underscores (e.g. low, medical_office).",
      }
    }
    const display_name = nonEmpty(formData.get("display_name"))
    if (!display_name) {
      return { ok: false, error: "Display name is required." }
    }
    const color = nonEmpty(formData.get("color"))
    const sort_order = asInt(formData.get("sort_order")) ?? 0
    const metadata = buildMetadata(category, formData)

    const supabase = await createClient()
    const { error } = await supabase.from("accident_dropdowns").insert({
      facility_id: facility.facilityId,
      category,
      key,
      display_name,
      color,
      sort_order,
      metadata,
      is_active: true,
    })

    if (error) {
      return { ok: false, error: dbError(error, "Failed to create dropdown.") }
    }
    revalidatePath("/admin/accident-reports")
    updateTag(accidentDropdownsTag(facility.facilityId))
    return { ok: true, message: "Dropdown created." }
  } catch (e) {
    logServerError("admin/accident-reports/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function updateDropdown(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing dropdown id." }

    const rawCategory = nonEmpty(formData.get("category"))
    if (!rawCategory || !isDropdownCategory(rawCategory)) {
      return { ok: false, error: "Invalid category." }
    }
    const category: DropdownCategory = rawCategory

    const key = nonEmpty(formData.get("key"))
    if (!key) return { ok: false, error: "Key is required." }
    if (!KEY_RE.test(key)) {
      return {
        ok: false,
        error:
          "Key must be lowercase letters, digits, and underscores (e.g. low, medical_office).",
      }
    }
    const display_name = nonEmpty(formData.get("display_name"))
    if (!display_name) {
      return { ok: false, error: "Display name is required." }
    }
    const color = nonEmpty(formData.get("color"))
    const sort_order = asInt(formData.get("sort_order"))
    const is_active = formData.get("is_active") === "on"
    const metadata = buildMetadata(category, formData)

    const supabase = await createClient()
    const { error } = await supabase
      .from("accident_dropdowns")
      .update({
        key,
        display_name,
        color,
        ...(sort_order !== null ? { sort_order } : {}),
        is_active,
        metadata,
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)

    if (error) {
      return { ok: false, error: dbError(error, "Failed to update dropdown.") }
    }
    revalidatePath("/admin/accident-reports")
    updateTag(accidentDropdownsTag(facility.facilityId))
    return { ok: true, message: "Dropdown updated." }
  } catch (e) {
    logServerError("admin/accident-reports/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function setDropdownActive(
  id: string,
  active: boolean,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing dropdown id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("accident_dropdowns")
      .update({ is_active: active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update dropdown.") }
    }
    revalidatePath("/admin/accident-reports")
    updateTag(accidentDropdownsTag(facility.facilityId))
    return { ok: true }
  } catch (e) {
    logServerError("admin/accident-reports/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteDropdown(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing dropdown id." }
    const supabase = await createClient()

    // Look up category to give a category-aware error if blocked.
    const { data: existing } = await supabase
      .from("accident_dropdowns")
      .select("category")
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    const category = existing?.category as DropdownCategory | undefined

    const { error } = await supabase
      .from("accident_dropdowns")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)

    if (error) {
      if (error.code === "23503") {
        if (category === "body_part") {
          return {
            ok: false,
            error:
              "Cannot delete; in use on existing reports. Deactivate instead.",
          }
        }
        return {
          ok: false,
          error:
            "Cannot delete; in use by existing reports. Deactivate instead.",
        }
      }
      return { ok: false, error: dbError(error, "Failed to delete dropdown.") }
    }
    revalidatePath("/admin/accident-reports")
    updateTag(accidentDropdownsTag(facility.facilityId))
    return { ok: true }
  } catch (e) {
    logServerError("admin/accident-reports/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// ============================================================================
// Seed defaults — replicate `seed_default_accident_dropdowns` inline.
// Idempotent via `(facility_id, category, key)` unique constraint with
// upsert ignoreDuplicates.
// ============================================================================

type SeedRow = {
  category: DropdownCategory
  key: string
  display_name: string
  sort_order: number
  color?: string
  metadata?: Json
}

const SEED_BODY_PARTS: ReadonlyArray<SeedRow> = [
  { category: "body_part", key: "feet", display_name: "Feet", sort_order: 1 },
  { category: "body_part", key: "ankles", display_name: "Ankles", sort_order: 2 },
  { category: "body_part", key: "lower_legs", display_name: "Lower Legs", sort_order: 3 },
  { category: "body_part", key: "knees", display_name: "Knees", sort_order: 4 },
  { category: "body_part", key: "upper_legs", display_name: "Upper Legs", sort_order: 5 },
  { category: "body_part", key: "hips", display_name: "Hips", sort_order: 6 },
  { category: "body_part", key: "torso", display_name: "Torso", sort_order: 7 },
  { category: "body_part", key: "elbows", display_name: "Elbows", sort_order: 9 },
  { category: "body_part", key: "hands", display_name: "Hands", sort_order: 10 },
  { category: "body_part", key: "fingers", display_name: "Fingers", sort_order: 11 },
  { category: "body_part", key: "head_neck", display_name: "Head/Neck", sort_order: 12 },
  { category: "body_part", key: "wrists", display_name: "Wrists", sort_order: 17 },
  { category: "body_part", key: "upper_arms", display_name: "Upper Arms", sort_order: 18 },
  { category: "body_part", key: "lower_arms", display_name: "Lower Arms", sort_order: 19 },
]

const SEED_SEVERITY: ReadonlyArray<SeedRow> = [
  { category: "severity", key: "low", display_name: "Low", color: "#16a34a", sort_order: 1 },
  { category: "severity", key: "medium", display_name: "Medium", color: "#f59e0b", sort_order: 2 },
  { category: "severity", key: "high", display_name: "High", color: "#ef4444", sort_order: 3 },
  { category: "severity", key: "critical", display_name: "Critical", color: "#7f1d1d", sort_order: 4 },
]

const SEED_MEDICAL: ReadonlyArray<SeedRow> = [
  { category: "medical_attention", key: "none", display_name: "None", sort_order: 1 },
  { category: "medical_attention", key: "first_aid", display_name: "First Aid", sort_order: 2 },
  {
    category: "medical_attention",
    key: "medical_office",
    display_name: "Medical Office Visit",
    sort_order: 3,
    metadata: { triggers_alert: true },
  },
  {
    category: "medical_attention",
    key: "er",
    display_name: "Emergency Room",
    sort_order: 4,
    metadata: { triggers_alert: true },
  },
  {
    category: "medical_attention",
    key: "hospitalization",
    display_name: "Hospitalization",
    sort_order: 5,
    metadata: { triggers_alert: true },
  },
]

const SEED_INJURY: ReadonlyArray<SeedRow> = [
  { category: "injury_type", key: "cut", display_name: "Cut", sort_order: 1 },
  { category: "injury_type", key: "bruise", display_name: "Bruise", sort_order: 2 },
  { category: "injury_type", key: "sprain", display_name: "Sprain", sort_order: 3 },
  { category: "injury_type", key: "strain", display_name: "Strain", sort_order: 4 },
  { category: "injury_type", key: "fracture", display_name: "Fracture", sort_order: 5 },
  { category: "injury_type", key: "concussion", display_name: "Concussion", sort_order: 6 },
  { category: "injury_type", key: "burn", display_name: "Burn", sort_order: 7 },
  { category: "injury_type", key: "puncture", display_name: "Puncture", sort_order: 8 },
  { category: "injury_type", key: "dislocation", display_name: "Dislocation", sort_order: 9 },
  { category: "injury_type", key: "other", display_name: "Other", sort_order: 10 },
]

const SEED_LOCATION: ReadonlyArray<SeedRow> = [
  { category: "location", key: "ice_surface", display_name: "Ice Surface", sort_order: 1 },
  { category: "location", key: "bench", display_name: "Bench", sort_order: 2 },
  { category: "location", key: "locker_room", display_name: "Locker Room", sort_order: 3 },
  { category: "location", key: "lobby", display_name: "Lobby", sort_order: 4 },
  { category: "location", key: "concession", display_name: "Concession", sort_order: 5 },
  { category: "location", key: "parking_lot", display_name: "Parking Lot", sort_order: 6 },
  { category: "location", key: "boardroom", display_name: "Boardroom", sort_order: 7 },
  { category: "location", key: "other", display_name: "Other", sort_order: 8 },
]

const SEED_ACTIVITY: ReadonlyArray<SeedRow> = [
  { category: "activity", key: "skating", display_name: "Skating", sort_order: 1 },
  { category: "activity", key: "coaching", display_name: "Coaching", sort_order: 2 },
  { category: "activity", key: "instructing", display_name: "Instructing", sort_order: 3 },
  { category: "activity", key: "cleaning", display_name: "Cleaning", sort_order: 4 },
  { category: "activity", key: "maintenance", display_name: "Maintenance", sort_order: 5 },
  { category: "activity", key: "event_setup", display_name: "Event Setup", sort_order: 6 },
  { category: "activity", key: "walking", display_name: "Walking", sort_order: 7 },
  { category: "activity", key: "other", display_name: "Other", sort_order: 8 },
]

const ALL_SEEDS: ReadonlyArray<SeedRow> = [
  ...SEED_BODY_PARTS,
  ...SEED_SEVERITY,
  ...SEED_MEDICAL,
  ...SEED_INJURY,
  ...SEED_LOCATION,
  ...SEED_ACTIVITY,
]

// Sanity check — ensure the literal seeds cover all categories and any new
// category added later forces an update here.
const _ALL_CATEGORIES_COVERED: Record<DropdownCategory, true> = {
  injury_type: true,
  body_part: true,
  location: true,
  activity: true,
  medical_attention: true,
  severity: true,
}
void _ALL_CATEGORIES_COVERED
void DROPDOWN_CATEGORIES

export async function seedAccidentDefaults(): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const supabase = await createClient()

    const rows = ALL_SEEDS.map((s) => ({
      facility_id: facility.facilityId,
      category: s.category,
      key: s.key,
      display_name: s.display_name,
      color: s.color ?? null,
      sort_order: s.sort_order,
      is_active: true,
      metadata: s.metadata ?? {},
    }))

    const { error } = await supabase
      .from("accident_dropdowns")
      .upsert(rows, {
        onConflict: "facility_id,category,key",
        ignoreDuplicates: true,
      })

    if (error) {
      return { ok: false, error: dbError(error, "Failed to seed defaults.") }
    }
    revalidatePath("/admin/accident-reports")
    updateTag(accidentDropdownsTag(facility.facilityId))
    return { ok: true }
  } catch (e) {
    logServerError("admin/accident-reports/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// ============================================================================
// Workers' Comp instructions (per-facility, single active row)
// ============================================================================

export async function updateWorkersCompInstructions(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const raw = formData.get("instructions")
    const instructions = typeof raw === "string" ? raw.replace(/\s+$/g, "") : ""

    const supabase = await createClient()

    const { data: existing } = await supabase
      .from("accident_workers_comp_settings")
      .select("id")
      .eq("facility_id", facility.facilityId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing?.id) {
      const { error } = await supabase
        .from("accident_workers_comp_settings")
        .update({ instructions })
        .eq("id", existing.id)
        .eq("facility_id", facility.facilityId)
      if (error) {
        return {
          ok: false,
          error: dbError(error, "Failed to update instructions."),
        }
      }
    } else {
      const { error } = await supabase
        .from("accident_workers_comp_settings")
        .insert({
          facility_id: facility.facilityId,
          instructions,
          is_active: true,
        })
      if (error) {
        return {
          ok: false,
          error: dbError(error, "Failed to save instructions."),
        }
      }
    }

    revalidatePath("/admin/accident-reports")
    return { ok: true, message: "Workers' Comp instructions saved." }
  } catch (e) {
    logServerError("admin/accident-reports/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// ============================================================================
// Follow-up notes (append-only — DB RLS denies UPDATE/DELETE)
// ============================================================================

export async function addAccidentFollowupNote(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const accident_id = nonEmpty(formData.get("accident_id"))
    if (!accident_id) return { ok: false, error: "Missing report id." }
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

    const { error } = await supabase.from("accident_followup_notes").insert({
      facility_id: facility.facilityId,
      accident_id,
      employee_id,
      body,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to add note.") }
    }
    revalidatePath("/admin/accident-reports")
    return { ok: true, message: "Note added." }
  } catch (e) {
    logServerError("admin/accident-reports/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}
