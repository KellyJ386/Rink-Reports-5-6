"use server"

import { revalidatePath, updateTag } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/observability/log-server-error"

import { facilityDropdownsTag } from "./_lib/facility-dropdowns"
import {
  isDomain,
  validateDomainKey,
  type ActionState,
  type DropdownDomain,
  type SimpleResult,
} from "./types"

type SupabaseError = { code?: string; message?: string } | null

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
    return "An option with that key already exists in this list."
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

/** Pulls + validates the shared fields used by create and update. */
function readForm(formData: FormData):
  | {
      ok: true
      domain: DropdownDomain
      key: string
      display_name: string
      color: string | null
      sort_order: number | null
    }
  | { ok: false; error: string } {
  const rawDomain = nonEmpty(formData.get("domain"))
  if (!rawDomain || !isDomain(rawDomain)) {
    return { ok: false, error: "Invalid list." }
  }
  const domain: DropdownDomain = rawDomain

  const key = nonEmpty(formData.get("key"))
  if (!key) return { ok: false, error: "Key is required." }
  const keyCheck = validateDomainKey(domain, key)
  if (!keyCheck.ok) return { ok: false, error: keyCheck.error }

  const display_name = nonEmpty(formData.get("display_name"))
  if (!display_name) return { ok: false, error: "Display name is required." }

  return {
    ok: true,
    domain,
    key,
    display_name,
    color: nonEmpty(formData.get("color")),
    sort_order: asInt(formData.get("sort_order")),
  }
}

export async function createOption(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const parsed = readForm(formData)
    if (!parsed.ok) return { ok: false, error: parsed.error }

    const supabase = await createClient()
    const { error } = await supabase.from("facility_dropdown_options").insert({
      facility_id: facility.facilityId,
      domain: parsed.domain,
      key: parsed.key,
      display_name: parsed.display_name,
      color: parsed.color,
      sort_order: parsed.sort_order ?? 0,
      is_active: true,
      metadata: {},
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to create option.") }
    }
    revalidatePath("/admin/lists")
    updateTag(facilityDropdownsTag(facility.facilityId, parsed.domain))
    return { ok: true, message: "Option created." }
  } catch (e) {
    logServerError("admin/lists/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function updateOption(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing option id." }

    const parsed = readForm(formData)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const is_active = formData.get("is_active") === "on"

    const supabase = await createClient()
    const { error } = await supabase
      .from("facility_dropdown_options")
      .update({
        key: parsed.key,
        display_name: parsed.display_name,
        color: parsed.color,
        ...(parsed.sort_order !== null ? { sort_order: parsed.sort_order } : {}),
        is_active,
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update option.") }
    }
    revalidatePath("/admin/lists")
    updateTag(facilityDropdownsTag(facility.facilityId, parsed.domain))
    return { ok: true, message: "Option updated." }
  } catch (e) {
    logServerError("admin/lists/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function setOptionActive(
  id: string,
  domain: string,
  active: boolean,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing option id." }
    if (!isDomain(domain)) return { ok: false, error: "Invalid list." }

    const supabase = await createClient()
    const { error } = await supabase
      .from("facility_dropdown_options")
      .update({ is_active: active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update option.") }
    }
    revalidatePath("/admin/lists")
    updateTag(facilityDropdownsTag(facility.facilityId, domain))
    return { ok: true }
  } catch (e) {
    logServerError("admin/lists/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteOption(
  id: string,
  domain: string,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing option id." }
    if (!isDomain(domain)) return { ok: false, error: "Invalid list." }

    const supabase = await createClient()
    const { error } = await supabase
      .from("facility_dropdown_options")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      if (error.code === "23503") {
        return {
          ok: false,
          error: "Cannot delete; in use by existing records. Deactivate instead.",
        }
      }
      return { ok: false, error: dbError(error, "Failed to delete option.") }
    }
    revalidatePath("/admin/lists")
    updateTag(facilityDropdownsTag(facility.facilityId, domain))
    return { ok: true }
  } catch (e) {
    logServerError("admin/lists/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/**
 * Re-seed the canonical defaults for a domain via the DB seed function
 * (idempotent: ON CONFLICT DO NOTHING, so admin edits are preserved). Mirrors
 * seedAccidentDefaults but delegates to the SECURITY DEFINER RPC.
 */
export async function seedDomainDefaults(domain: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!isDomain(domain)) return { ok: false, error: "Invalid list." }

    const supabase = await createClient()
    const { error } = await supabase.rpc(
      "seed_default_facility_dropdown_options",
      { p_facility_id: facility.facilityId },
    )
    if (error) {
      return { ok: false, error: dbError(error, "Failed to seed defaults.") }
    }
    revalidatePath("/admin/lists")
    updateTag(facilityDropdownsTag(facility.facilityId, domain))
    return { ok: true }
  } catch (e) {
    logServerError("admin/lists/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}
