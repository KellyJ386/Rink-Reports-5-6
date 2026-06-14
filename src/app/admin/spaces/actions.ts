"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/observability/log-server-error"

import type { ActionState, BulkImportResult, SimpleResult } from "./types"

type SupabaseError = { code?: string; message?: string } | null

const SPACE_SLUG_RE = /^[a-z0-9]+([_-][a-z0-9]+)*$/

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

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  if (err.code === "23505") {
    return "That value conflicts with an existing record (duplicate)."
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

// facility_spaces is consumed by several modules; refresh their admin caches
// too so a freshly-added space appears everywhere without a manual reload.
function revalidateConsumers(): void {
  revalidatePath("/admin/spaces")
  revalidatePath("/admin/incident-reports")
  revalidatePath("/admin/accident-reports")
  revalidatePath("/admin/air-quality")
}

// ============================================================================
// Facility Spaces (shared facility-wide list)
//   Writes require facility admin OR an admin of a consuming module.
// ============================================================================

export async function createFacilitySpace(
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
    if (!SPACE_SLUG_RE.test(slug)) {
      return {
        ok: false,
        error:
          "Slug must be lowercase letters, digits, hyphens, or underscores (e.g. main-rink).",
      }
    }
    const sort_order = asInt(formData.get("sort_order")) ?? 0

    const supabase = await createClient()
    const { error } = await supabase.from("facility_spaces").insert({
      facility_id: facility.facilityId,
      name,
      slug,
      sort_order,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to create space.") }
    }
    revalidateConsumers()
    return { ok: true, message: "Facility space created." }
  } catch (e) {
    logServerError("admin/spaces/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function updateFacilitySpace(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing space id." }

    const name = nonEmpty(formData.get("name"))
    if (!name) return { ok: false, error: "Name is required." }
    const rawSlug = nonEmpty(formData.get("slug"))
    const slug = rawSlug ?? slugify(name)
    if (!SPACE_SLUG_RE.test(slug)) {
      return {
        ok: false,
        error:
          "Slug must be lowercase letters, digits, hyphens, or underscores (e.g. main-rink).",
      }
    }
    const sort_order = asInt(formData.get("sort_order"))
    const is_active = formData.get("is_active") === "on"

    const supabase = await createClient()
    const { error } = await supabase
      .from("facility_spaces")
      .update({
        name,
        slug,
        ...(sort_order !== null ? { sort_order } : {}),
        is_active,
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update space.") }
    }
    revalidateConsumers()
    return { ok: true, message: "Facility space updated." }
  } catch (e) {
    logServerError("admin/spaces/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function setFacilitySpaceActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing space id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("facility_spaces")
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update space.") }
    }
    revalidateConsumers()
    return { ok: true }
  } catch (e) {
    logServerError("admin/spaces/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteFacilitySpace(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing space id." }
    const supabase = await createClient()

    // incident_report_spaces.space_id is `on delete restrict`, so a delete
    // would error if any report references it. Count first for a clear message.
    const { count } = await supabase
      .from("incident_report_spaces")
      .select("id", { count: "exact", head: true })
      .eq("space_id", id)
    if ((count ?? 0) > 0) {
      return {
        ok: false,
        error: `Cannot delete; in use by ${count} report${count === 1 ? "" : "s"}. Deactivate instead.`,
      }
    }

    const { error } = await supabase
      .from("facility_spaces")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      if (error.code === "23503") {
        return {
          ok: false,
          error:
            "Cannot delete; in use by existing reports. Deactivate instead.",
        }
      }
      return { ok: false, error: dbError(error, "Failed to delete space.") }
    }
    revalidateConsumers()
    return { ok: true }
  } catch (e) {
    logServerError("admin/spaces/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Seed defaults — de-duped union of the historical incident + accident
// location starter sets. Idempotent via on conflict (facility_id, slug).
// ============================================================================

const DEFAULT_SPACES: ReadonlyArray<{
  name: string
  slug: string
  sort_order: number
}> = [
  { name: "Main Rink", slug: "main_rink", sort_order: 1 },
  { name: "Lobby", slug: "lobby", sort_order: 2 },
  { name: "Locker Room", slug: "locker_room", sort_order: 3 },
  { name: "Pro Shop", slug: "pro_shop", sort_order: 4 },
  { name: "Parking Lot", slug: "parking_lot", sort_order: 5 },
  { name: "Ice Surface", slug: "ice_surface", sort_order: 6 },
  { name: "Bench", slug: "bench", sort_order: 7 },
  { name: "Concession", slug: "concession", sort_order: 8 },
  { name: "Boardroom", slug: "boardroom", sort_order: 9 },
  { name: "Other", slug: "other", sort_order: 10 },
]

export async function seedFacilitySpaces(): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const supabase = await createClient()
    const rows = DEFAULT_SPACES.map((s) => ({
      facility_id: facility.facilityId,
      name: s.name,
      slug: s.slug,
      sort_order: s.sort_order,
      is_active: true,
    }))
    const { error } = await supabase
      .from("facility_spaces")
      .upsert(rows, { onConflict: "facility_id,slug", ignoreDuplicates: true })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to seed spaces.") }
    }
    revalidateConsumers()
    return { ok: true }
  } catch (e) {
    logServerError("admin/spaces/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Bulk CSV import. Columns: `name[, slug][, sort_order]`. Duplicate slugs
// (existing or within the file) are skipped, not overwritten.
// ============================================================================

function parseCsvLines(csv: string): string[][] {
  return csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(",").map((cell) => cell.trim()))
}

export async function bulkImportFacilitySpaces(
  csv: string,
): Promise<BulkImportResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const lines = parseCsvLines(csv)
    if (lines.length === 0) return { ok: false, error: "No rows found." }
    if (lines[0]![0]?.toLowerCase() === "name") lines.shift()

    const errors: string[] = []
    const seen = new Set<string>()
    const rows: Array<{
      facility_id: string
      name: string
      slug: string
      sort_order: number
      is_active: boolean
    }> = []

    lines.forEach((cells, i) => {
      const lineNo = i + 1
      const name = cells[0] ?? ""
      if (!name) {
        errors.push(`Row ${lineNo}: name is required.`)
        return
      }
      const slug = cells[1] ? slugify(cells[1]) : slugify(name)
      if (!SPACE_SLUG_RE.test(slug)) {
        errors.push(`Row ${lineNo}: could not derive a valid slug from "${name}".`)
        return
      }
      if (seen.has(slug)) return
      seen.add(slug)
      const sort_order =
        cells[2] && Number.isFinite(Number(cells[2]))
          ? Math.trunc(Number(cells[2]))
          : i
      rows.push({
        facility_id: facility.facilityId,
        name,
        slug,
        sort_order,
        is_active: true,
      })
    })

    if (rows.length === 0) {
      return { ok: false, error: errors[0] ?? "No valid rows to import." }
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("facility_spaces")
      .upsert(rows, { onConflict: "facility_id,slug", ignoreDuplicates: true })
      .select("id")
    if (error) {
      return { ok: false, error: dbError(error, "Failed to import spaces.") }
    }
    const inserted = data?.length ?? 0
    revalidateConsumers()
    return { ok: true, inserted, skipped: rows.length - inserted, errors }
  } catch (e) {
    logServerError("admin/spaces/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}
