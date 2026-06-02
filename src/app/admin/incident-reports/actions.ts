"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import type { ActionState, IncidentStatus, SimpleResult } from "./types"
import { isIncidentStatus } from "./types"

type SupabaseError = { code?: string; message?: string } | null

const TYPE_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const SEVERITY_KEY_RE = /^[a-z0-9_]+$/
const ACTIVITY_KEY_RE = /^[a-z0-9_]+$/
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

// ============================================================================
// Incident Types
// ============================================================================

export async function createIncidentType(
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
    if (!TYPE_SLUG_RE.test(slug)) {
      return {
        ok: false,
        error:
          "Slug must be lowercase letters, digits, and hyphens (e.g. safety-concern).",
      }
    }

    const color = nonEmpty(formData.get("color"))
    const sort_order = asInt(formData.get("sort_order")) ?? 0

    const supabase = await createClient()
    const { error } = await supabase.from("incident_types").insert({
      facility_id: facility.facilityId,
      name,
      slug,
      color,
      sort_order,
    })

    if (error) {
      return { ok: false, error: dbError(error, "Failed to create type.") }
    }
    revalidatePath("/admin/incident-reports")
    return { ok: true, message: "Incident type created." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function updateIncidentType(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing type id." }

    const name = nonEmpty(formData.get("name"))
    if (!name) return { ok: false, error: "Name is required." }

    const rawSlug = nonEmpty(formData.get("slug"))
    const slug = rawSlug ?? slugify(name)
    if (!TYPE_SLUG_RE.test(slug)) {
      return {
        ok: false,
        error:
          "Slug must be lowercase letters, digits, and hyphens (e.g. safety-concern).",
      }
    }

    const color = nonEmpty(formData.get("color"))
    const sort_order = asInt(formData.get("sort_order"))
    const is_active = formData.get("is_active") === "on"

    const supabase = await createClient()
    const { error } = await supabase
      .from("incident_types")
      .update({
        name,
        slug,
        color,
        ...(sort_order !== null ? { sort_order } : {}),
        is_active,
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)

    if (error) {
      return { ok: false, error: dbError(error, "Failed to update type.") }
    }
    revalidatePath("/admin/incident-reports")
    return { ok: true, message: "Incident type updated." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function setIncidentTypeActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing type id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("incident_types")
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update type.") }
    }
    revalidatePath("/admin/incident-reports")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteIncidentType(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing type id." }
    const supabase = await createClient()

    // The FK on incident_reports.incident_type_id is `on delete set null`, so
    // a delete won't actually error from referenced reports — but we still
    // want to warn the admin if reports reference this type. Count first.
    const { count } = await supabase
      .from("incident_reports")
      .select("id", { count: "exact", head: true })
      .eq("incident_type_id", id)

    if ((count ?? 0) > 0) {
      return {
        ok: false,
        error: `Cannot delete; in use by ${count} report${count === 1 ? "" : "s"}. Deactivate instead.`,
      }
    }

    const { error } = await supabase
      .from("incident_types")
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
      return { ok: false, error: dbError(error, "Failed to delete type.") }
    }
    revalidatePath("/admin/incident-reports")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Severity Levels
// ============================================================================

export async function createSeverityLevel(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const key = nonEmpty(formData.get("key"))
    if (!key) return { ok: false, error: "Key is required." }
    if (!SEVERITY_KEY_RE.test(key)) {
      return {
        ok: false,
        error:
          "Key must be lowercase letters, digits, and underscores (e.g. high, very_high).",
      }
    }
    const display_name = nonEmpty(formData.get("display_name"))
    if (!display_name) {
      return { ok: false, error: "Display name is required." }
    }
    const color = nonEmpty(formData.get("color"))
    const sort_order = asInt(formData.get("sort_order")) ?? 0

    const supabase = await createClient()
    const { error } = await supabase.from("incident_severity_levels").insert({
      facility_id: facility.facilityId,
      key,
      display_name,
      color,
      sort_order,
    })

    if (error) {
      return { ok: false, error: dbError(error, "Failed to create severity.") }
    }
    revalidatePath("/admin/incident-reports")
    return { ok: true, message: "Severity level created." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function updateSeverityLevel(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing severity id." }

    const key = nonEmpty(formData.get("key"))
    if (!key) return { ok: false, error: "Key is required." }
    if (!SEVERITY_KEY_RE.test(key)) {
      return {
        ok: false,
        error:
          "Key must be lowercase letters, digits, and underscores (e.g. high, very_high).",
      }
    }
    const display_name = nonEmpty(formData.get("display_name"))
    if (!display_name) {
      return { ok: false, error: "Display name is required." }
    }
    const color = nonEmpty(formData.get("color"))
    const sort_order = asInt(formData.get("sort_order"))
    const is_active = formData.get("is_active") === "on"

    const supabase = await createClient()
    const { error } = await supabase
      .from("incident_severity_levels")
      .update({
        key,
        display_name,
        color,
        ...(sort_order !== null ? { sort_order } : {}),
        is_active,
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)

    if (error) {
      return { ok: false, error: dbError(error, "Failed to update severity.") }
    }
    revalidatePath("/admin/incident-reports")
    return { ok: true, message: "Severity level updated." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function setSeverityLevelActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing severity id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("incident_severity_levels")
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update severity.") }
    }
    revalidatePath("/admin/incident-reports")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteSeverityLevel(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing severity id." }
    const supabase = await createClient()

    // Same `on delete set null` situation as types — warn instead.
    const { count } = await supabase
      .from("incident_reports")
      .select("id", { count: "exact", head: true })
      .eq("severity_level_id", id)

    if ((count ?? 0) > 0) {
      return {
        ok: false,
        error: `Cannot delete; in use by ${count} report${count === 1 ? "" : "s"}. Deactivate instead.`,
      }
    }

    const { error } = await supabase
      .from("incident_severity_levels")
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
      return { ok: false, error: dbError(error, "Failed to delete severity.") }
    }
    revalidatePath("/admin/incident-reports")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Bootstrap helper — seed defaults
//
// The DB has a SECURITY DEFINER `seed_default_incident_types_and_severities`
// function but it is service_role-only, so we replicate its inserts inline so
// the call works under the admin's session. Idempotent via the same unique
// constraints.
// ============================================================================

const DEFAULT_SEVERITIES: ReadonlyArray<{
  key: string
  display_name: string
  sort_order: number
}> = [
  { key: "critical", display_name: "Critical", sort_order: 1 },
  { key: "high", display_name: "High", sort_order: 2 },
  { key: "medium", display_name: "Medium", sort_order: 3 },
  { key: "low", display_name: "Low", sort_order: 4 },
]

const DEFAULT_TYPES: ReadonlyArray<{
  name: string
  slug: string
  sort_order: number
}> = [
  { name: "Theft", slug: "theft", sort_order: 1 },
  { name: "Vandalism", slug: "vandalism", sort_order: 2 },
  { name: "Safety Concern", slug: "safety_concern", sort_order: 3 },
  { name: "Other", slug: "other", sort_order: 4 },
]

export async function seedIncidentDefaults(): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const supabase = await createClient()

    const sevRows = DEFAULT_SEVERITIES.map((s) => ({
      facility_id: facility.facilityId,
      key: s.key,
      display_name: s.display_name,
      sort_order: s.sort_order,
      is_active: true,
    }))
    const { error: sevErr } = await supabase
      .from("incident_severity_levels")
      .upsert(sevRows, {
        onConflict: "facility_id,key",
        ignoreDuplicates: true,
      })
    if (sevErr) {
      return { ok: false, error: dbError(sevErr, "Failed to seed severities.") }
    }

    const typeRows = DEFAULT_TYPES.map((t) => ({
      facility_id: facility.facilityId,
      name: t.name,
      slug: t.slug,
      sort_order: t.sort_order,
      is_active: true,
    }))
    const { error: typeErr } = await supabase
      .from("incident_types")
      .upsert(typeRows, {
        onConflict: "facility_id,slug",
        ignoreDuplicates: true,
      })
    if (typeErr) {
      return { ok: false, error: dbError(typeErr, "Failed to seed types.") }
    }

    revalidatePath("/admin/incident-reports")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Status transitions
//
// Policy: setting a status always stamps the corresponding *_at timestamp to
// `now()` (overwriting any prior value for that bucket). This keeps the audit
// trail on the most recent transition and is the simplest invariant for
// admins who occasionally re-mark a report. We *only* touch `status` and the
// matching timestamp; nothing else on the row is exposed.
// ============================================================================

export async function setReportStatus(
  reportId: string,
  newStatus: IncidentStatus,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!reportId) return { ok: false, error: "Missing report id." }
    if (!isIncidentStatus(newStatus)) {
      return { ok: false, error: "Invalid status." }
    }

    const supabase = await createClient()
    const nowIso = new Date().toISOString()

    const update: {
      status: IncidentStatus
      reviewed_at?: string
      resolved_at?: string
      archived_at?: string
    } = { status: newStatus }

    if (newStatus === "in_review") update.reviewed_at = nowIso
    if (newStatus === "resolved") update.resolved_at = nowIso
    if (newStatus === "archived") update.archived_at = nowIso
    // 'submitted' clears nothing — original submitted_at lives on the row.

    const { error } = await supabase
      .from("incident_reports")
      .update(update)
      .eq("id", reportId)
      .eq("facility_id", facility.facilityId)

    if (error) {
      return { ok: false, error: dbError(error, "Failed to update status.") }
    }
    revalidatePath("/admin/incident-reports")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Follow-up notes (append-only — DB RLS denies UPDATE/DELETE)
// ============================================================================

export async function addFollowupNote(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const incident_id = nonEmpty(formData.get("incident_id"))
    if (!incident_id) return { ok: false, error: "Missing report id." }
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

    const { error } = await supabase.from("incident_followup_notes").insert({
      facility_id: facility.facilityId,
      incident_id,
      employee_id,
      body,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to add note.") }
    }
    revalidatePath("/admin/incident-reports")
    return { ok: true, message: "Note added." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Activities ("Activity at the time" — incident-owned dropdown)
// ============================================================================

export async function createIncidentActivity(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const key = nonEmpty(formData.get("key"))
    if (!key) return { ok: false, error: "Key is required." }
    if (!ACTIVITY_KEY_RE.test(key)) {
      return {
        ok: false,
        error:
          "Key must be lowercase letters, digits, and underscores (e.g. public_skating).",
      }
    }
    const display_name = nonEmpty(formData.get("display_name"))
    if (!display_name) return { ok: false, error: "Display name is required." }
    const color = nonEmpty(formData.get("color"))
    const sort_order = asInt(formData.get("sort_order")) ?? 0

    const supabase = await createClient()
    const { error } = await supabase.from("incident_activities").insert({
      facility_id: facility.facilityId,
      key,
      display_name,
      color,
      sort_order,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to create activity.") }
    }
    revalidatePath("/admin/incident-reports")
    return { ok: true, message: "Activity created." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function updateIncidentActivity(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing activity id." }

    const key = nonEmpty(formData.get("key"))
    if (!key) return { ok: false, error: "Key is required." }
    if (!ACTIVITY_KEY_RE.test(key)) {
      return {
        ok: false,
        error:
          "Key must be lowercase letters, digits, and underscores (e.g. public_skating).",
      }
    }
    const display_name = nonEmpty(formData.get("display_name"))
    if (!display_name) return { ok: false, error: "Display name is required." }
    const color = nonEmpty(formData.get("color"))
    const sort_order = asInt(formData.get("sort_order"))
    const is_active = formData.get("is_active") === "on"

    const supabase = await createClient()
    const { error } = await supabase
      .from("incident_activities")
      .update({
        key,
        display_name,
        color,
        ...(sort_order !== null ? { sort_order } : {}),
        is_active,
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update activity.") }
    }
    revalidatePath("/admin/incident-reports")
    return { ok: true, message: "Activity updated." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function setIncidentActivityActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing activity id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("incident_activities")
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update activity.") }
    }
    revalidatePath("/admin/incident-reports")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteIncidentActivity(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing activity id." }
    const supabase = await createClient()

    // activity_id is `on delete set null`, so a delete won't error from
    // referenced reports — warn the admin instead and suggest deactivating.
    const { count } = await supabase
      .from("incident_reports")
      .select("id", { count: "exact", head: true })
      .eq("activity_id", id)
    if ((count ?? 0) > 0) {
      return {
        ok: false,
        error: `Cannot delete; in use by ${count} report${count === 1 ? "" : "s"}. Deactivate instead.`,
      }
    }

    const { error } = await supabase
      .from("incident_activities")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to delete activity.") }
    }
    revalidatePath("/admin/incident-reports")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Facility Spaces (shared facility-wide list; writes require facility admin)
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
    revalidatePath("/admin/incident-reports")
    return { ok: true, message: "Facility space created." }
  } catch (e) {
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
    revalidatePath("/admin/incident-reports")
    return { ok: true, message: "Facility space updated." }
  } catch (e) {
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
    revalidatePath("/admin/incident-reports")
    return { ok: true }
  } catch (e) {
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
    revalidatePath("/admin/incident-reports")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Seed defaults — activities & facility spaces
//
// Mirrors seedIncidentDefaults: the DB SECURITY DEFINER seeders are
// service_role-only, so we replicate their inserts inline under the admin's
// session. Idempotent via the same unique constraints.
// ============================================================================

const DEFAULT_ACTIVITIES: ReadonlyArray<{
  key: string
  display_name: string
  sort_order: number
}> = [
  { key: "public_skating", display_name: "Public Skating", sort_order: 1 },
  { key: "hockey", display_name: "Hockey", sort_order: 2 },
  { key: "figure_skating", display_name: "Figure Skating", sort_order: 3 },
  { key: "learn_to_skate", display_name: "Learn to Skate", sort_order: 4 },
  { key: "maintenance", display_name: "Maintenance", sort_order: 5 },
]

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
]

export async function seedIncidentActivities(): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const supabase = await createClient()
    const rows = DEFAULT_ACTIVITIES.map((a) => ({
      facility_id: facility.facilityId,
      key: a.key,
      display_name: a.display_name,
      sort_order: a.sort_order,
      is_active: true,
    }))
    const { error } = await supabase
      .from("incident_activities")
      .upsert(rows, { onConflict: "facility_id,key", ignoreDuplicates: true })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to seed activities.") }
    }
    revalidatePath("/admin/incident-reports")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

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
    revalidatePath("/admin/incident-reports")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}
