"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/observability/log-server-error"

import type { ActionState, SimpleResult } from "./types"

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

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  if (err.code === "23505") {
    return "A department with that slug already exists in this facility."
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

export async function createDepartment(
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
          "Slug must be lowercase letters, digits, and hyphens (e.g. ice-crew).",
      }
    }

    const color = nonEmpty(formData.get("color"))
    const sort_order = asInt(formData.get("sort_order")) ?? 0

    const supabase = await createClient()
    const { error } = await supabase.from("departments").insert({
      facility_id: facility.facilityId,
      name,
      slug,
      color,
      sort_order,
    })

    if (error) {
      return { ok: false, error: dbError(error, "Failed to create department.") }
    }
    revalidatePath("/admin/departments")
    return { ok: true, message: "Department created." }
  } catch (e) {
    logServerError("admin/departments/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export type DepartmentOption = {
  id: string
  name: string
  slug: string
  color: string | null
  is_active: boolean
}

export type CreateDepartmentInlineResult =
  | { ok: true; department: DepartmentOption }
  | { ok: false; error: string }

/**
 * Create a department and return the created row, for the Scheduling Admin
 * inline "+ New department" control (mirrors job-areas' createJobArea). New
 * departments append to the end of the sort order and start active.
 */
export async function createDepartmentInline(args: {
  name: string
}): Promise<CreateDepartmentInlineResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const name = (args.name ?? "").trim()
    if (!name) return { ok: false, error: "Name is required." }
    const slug = slugify(name)
    if (!SLUG_RE.test(slug)) {
      return { ok: false, error: "Enter a name with letters or numbers." }
    }

    const supabase = await createClient()

    // Append to the end of the current order.
    const { data: last } = await supabase
      .from("departments")
      .select("sort_order")
      .eq("facility_id", facility.facilityId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle()
    const sort_order = (last?.sort_order ?? 0) + 1

    const { data, error } = await supabase
      .from("departments")
      .insert({
        facility_id: facility.facilityId,
        name,
        slug,
        sort_order,
        is_active: true,
      })
      .select("id, name, slug, color, is_active")
      .single()

    if (error || !data) {
      return { ok: false, error: dbError(error, "Failed to create department.") }
    }
    revalidatePath("/admin/departments")
    revalidatePath("/admin/scheduling/shifts")
    return {
      ok: true,
      department: {
        id: data.id,
        name: data.name,
        slug: data.slug,
        color: data.color,
        is_active: data.is_active,
      },
    }
  } catch (e) {
    logServerError("admin/departments/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function updateDepartment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing department id." }

    const name = nonEmpty(formData.get("name"))
    if (!name) return { ok: false, error: "Name is required." }

    const rawSlug = nonEmpty(formData.get("slug"))
    const slug = rawSlug ?? slugify(name)
    if (!SLUG_RE.test(slug)) {
      return {
        ok: false,
        error:
          "Slug must be lowercase letters, digits, and hyphens (e.g. ice-crew).",
      }
    }

    const color = nonEmpty(formData.get("color"))
    const sort_order = asInt(formData.get("sort_order"))
    const is_active = formData.get("is_active") === "on"

    const supabase = await createClient()
    const { error } = await supabase
      .from("departments")
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
      return { ok: false, error: dbError(error, "Failed to update department.") }
    }
    revalidatePath("/admin/departments")
    return { ok: true, message: "Department updated." }
  } catch (e) {
    logServerError("admin/departments/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function setDepartmentActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing department id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("departments")
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update department.") }
    }
    revalidatePath("/admin/departments")
    return { ok: true }
  } catch (e) {
    logServerError("admin/departments/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function reorderDepartment(
  id: string,
  sort_order: number,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing department id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("departments")
      .update({ sort_order })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to reorder department.") }
    }
    revalidatePath("/admin/departments")
    return { ok: true }
  } catch (e) {
    logServerError("admin/departments/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}
