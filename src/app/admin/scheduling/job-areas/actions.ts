"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

// employee_job_areas isn't in the generated types yet (see CLAUDE.md); cast
// through `any` at call sites, matching the offline_sync_queue convention.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any

const MAX_NAME = 60
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

export type JobAreaOption = { id: string; name: string }

export type CreateJobAreaResult =
  | { ok: true; area: JobAreaOption }
  | { ok: false; error: string }

export type SimpleResult = { ok: true } | { ok: false; error: string }

type SupabaseError = { code?: string; message?: string } | null

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
}

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  if (err.code === "23505") {
    return "A job area with that name already exists in this facility."
  }
  if (err.code === "23503") {
    return "That job area is assigned to employees — deactivate it instead of deleting."
  }
  return err.message?.trim() || fallback
}

/**
 * Resolve the target facility. Non-super-admins ALWAYS use their own profile
 * facility, ignoring any client-supplied id (defense-in-depth). Super admins
 * must pass an explicit, existing facility id. Mirrors the bulk-employee flow.
 */
async function resolveFacilityId(
  facilityIdFromClient: string | null
): Promise<{ ok: true; facilityId: string } | { ok: false; error: string }> {
  const current = await getCurrentUser()
  const profile = current?.profile
  if (!profile) return { ok: false, error: "Not signed in." }

  if (!profile.is_super_admin) {
    if (!profile.facility_id) {
      return { ok: false, error: "No facility assigned to your account." }
    }
    return { ok: true, facilityId: profile.facility_id }
  }

  const fromClient = facilityIdFromClient?.trim()
  if (!fromClient) {
    return { ok: false, error: "Super admin requires an explicit facility." }
  }
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("facilities")
    .select("id")
    .eq("id", fromClient)
    .maybeSingle()
  if (error || !data) return { ok: false, error: "Invalid facility id." }
  return { ok: true, facilityId: fromClient }
}

function revalidate() {
  revalidatePath("/admin/scheduling/job-areas")
  revalidatePath("/admin/employees/bulk")
}

/**
 * Create a new job area for a facility. Shared by the admin management page and
 * the bulk-add picker's inline "+ Create" — returns the created {id, name} so
 * the caller can immediately select it. New areas append to the end of the
 * sort order and start active.
 */
export async function createJobArea(args: {
  facilityId: string | null
  name: string
}): Promise<CreateJobAreaResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacilityId(args.facilityId)
    if (!facility.ok) return { ok: false, error: facility.error }

    const name = (args.name ?? "").trim()
    if (!name) return { ok: false, error: "Name is required." }
    if (name.length > MAX_NAME) {
      return { ok: false, error: `Name is too long (max ${MAX_NAME} characters).` }
    }
    const slug = slugify(name)
    if (!SLUG_RE.test(slug)) {
      return { ok: false, error: "Enter a name with letters or numbers." }
    }

    const supabase = (await createClient()) as AnySupabase

    // Append to the end of the current order.
    const { data: last } = await supabase
      .from("employee_job_areas")
      .select("sort_order")
      .eq("facility_id", facility.facilityId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle()
    const sort_order = (last?.sort_order ?? 0) + 1

    const { data, error } = await supabase
      .from("employee_job_areas")
      .insert({
        facility_id: facility.facilityId,
        name,
        slug,
        sort_order,
        is_active: true,
      })
      .select("id, name")
      .single()

    if (error || !data) {
      return { ok: false, error: dbError(error, "Failed to create job area.") }
    }
    revalidate()
    return { ok: true, area: { id: data.id as string, name: data.name as string } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/** Rename a job area (re-derives the slug). Facility isolation via RLS. */
export async function renameJobArea(id: string, name: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    if (!id) return { ok: false, error: "Missing job area id." }
    const trimmed = (name ?? "").trim()
    if (!trimmed) return { ok: false, error: "Name is required." }
    if (trimmed.length > MAX_NAME) {
      return { ok: false, error: `Name is too long (max ${MAX_NAME} characters).` }
    }
    const slug = slugify(trimmed)
    if (!SLUG_RE.test(slug)) {
      return { ok: false, error: "Enter a name with letters or numbers." }
    }

    const supabase = (await createClient()) as AnySupabase
    const { error } = await supabase
      .from("employee_job_areas")
      .update({ name: trimmed, slug })
      .eq("id", id)
    if (error) return { ok: false, error: dbError(error, "Failed to rename job area.") }
    revalidate()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/** Activate / deactivate a job area (soft-hide without losing history). */
export async function setJobAreaActive(
  id: string,
  isActive: boolean
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    if (!id) return { ok: false, error: "Missing job area id." }
    const supabase = (await createClient()) as AnySupabase
    const { error } = await supabase
      .from("employee_job_areas")
      .update({ is_active: isActive })
      .eq("id", id)
    if (error) return { ok: false, error: dbError(error, "Failed to update job area.") }
    revalidate()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/** Move a job area one slot up or down by swapping sort_order with its neighbor. */
export async function moveJobArea(
  id: string,
  direction: "up" | "down"
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    if (!id) return { ok: false, error: "Missing job area id." }
    const facility = await resolveFacilityId(null)
    if (!facility.ok) return { ok: false, error: facility.error }

    const supabase = (await createClient()) as AnySupabase
    const { data: rows, error: selErr } = await supabase
      .from("employee_job_areas")
      .select("id, sort_order")
      .eq("facility_id", facility.facilityId)
      .order("sort_order", { ascending: true })
    if (selErr) return { ok: false, error: dbError(selErr, "Failed to load job areas.") }

    const ordered = (rows ?? []) as Array<{ id: string; sort_order: number }>
    const idx = ordered.findIndex((r) => r.id === id)
    if (idx === -1) return { ok: false, error: "Job area not found." }
    const swapIdx = direction === "up" ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= ordered.length) return { ok: true } // already at edge

    const a = ordered[idx]
    const b = ordered[swapIdx]
    const { error: e1 } = await supabase
      .from("employee_job_areas")
      .update({ sort_order: b.sort_order })
      .eq("id", a.id)
    if (e1) return { ok: false, error: dbError(e1, "Failed to reorder.") }
    const { error: e2 } = await supabase
      .from("employee_job_areas")
      .update({ sort_order: a.sort_order })
      .eq("id", b.id)
    if (e2) return { ok: false, error: dbError(e2, "Failed to reorder.") }

    revalidate()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/** Delete a job area. Blocked by the FK (ON DELETE RESTRICT) if it's assigned
 *  to any employee — the caller is told to deactivate instead. */
export async function deleteJobArea(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    if (!id) return { ok: false, error: "Missing job area id." }
    const supabase = (await createClient()) as AnySupabase
    const { error } = await supabase.from("employee_job_areas").delete().eq("id", id)
    if (error) return { ok: false, error: dbError(error, "Failed to delete job area.") }
    revalidate()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ---------------------------------------------------------------------------
// Per-job-area certification requirements (job_area_certification_requirements)
// Enforced at assignment time by scheduling_assignment_violations().
// ---------------------------------------------------------------------------

const MAX_CERT_NAME = 200

/** Add a required certification (by name) to a job area. */
export async function addJobAreaCertRequirement(args: {
  jobAreaId: string
  certName: string
}): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacilityId(null)
    if (!facility.ok) return { ok: false, error: facility.error }
    const jobAreaId = (args.jobAreaId ?? "").trim()
    const certName = (args.certName ?? "").trim()
    if (!jobAreaId) return { ok: false, error: "Missing job area." }
    if (!certName) return { ok: false, error: "Enter a certification name." }
    if (certName.length > MAX_CERT_NAME) {
      return { ok: false, error: `Name is too long (max ${MAX_CERT_NAME}).` }
    }

    const supabase = (await createClient()) as AnySupabase
    const { error } = await supabase
      .from("job_area_certification_requirements")
      .insert({
        facility_id: facility.facilityId,
        job_area_id: jobAreaId,
        cert_name: certName,
        is_active: true,
      })
    if (error) {
      if (error.code === "23505") {
        return { ok: false, error: "That certification is already required here." }
      }
      return { ok: false, error: dbError(error, "Failed to add requirement.") }
    }
    revalidate()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/** Remove a certification requirement by id. */
export async function removeJobAreaCertRequirement(
  id: string
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    if (!id) return { ok: false, error: "Missing requirement id." }
    const supabase = (await createClient()) as AnySupabase
    const { error } = await supabase
      .from("job_area_certification_requirements")
      .delete()
      .eq("id", id)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to remove requirement.") }
    }
    revalidate()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}
