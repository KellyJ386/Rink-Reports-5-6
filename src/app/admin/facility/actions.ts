"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import {
  DEFAULT_TIMEZONE,
  SLUG_PATTERN,
  TIMEZONE_OPTIONS,
  type ActionResult,
  type FacilityFormInput,
} from "./types"

type CreateInput = {
  name: string
  slug: string
  timezone: string
  address?: string | null
  zip_code?: string | null
  phone?: string | null
}

type UpdateInput = Partial<FacilityFormInput>

type RawError = {
  code?: string
  message?: string
} | null

function describeDbError(err: RawError, fallback: string): string {
  if (!err) return fallback
  if (err.code === "23505") {
    return "That slug is already taken. Pick a unique slug."
  }
  return err.message?.trim() || fallback
}

function normalizeName(input: string): string {
  return input.trim().replace(/\s+/g, " ")
}

function normalizeSlug(input: string): string {
  return input.trim().toLowerCase()
}

function normalizeTimezone(input: string): string {
  const tz = input.trim() || DEFAULT_TIMEZONE
  if (!TIMEZONE_OPTIONS.includes(tz)) {
    return DEFAULT_TIMEZONE
  }
  return tz
}

async function requireSuperAdmin(): Promise<
  | { ok: true; userId: string }
  | { ok: false; error: string }
> {
  const current = await getCurrentUser()
  if (!current || !current.profile) {
    return { ok: false, error: "Not signed in." }
  }
  if (!current.profile.is_super_admin) {
    return { ok: false, error: "Only super admins can perform this action." }
  }
  return { ok: true, userId: current.profile.id }
}

function validateCreate(input: CreateInput): string | null {
  const name = normalizeName(input.name)
  const slug = normalizeSlug(input.slug)
  if (name.length < 2) return "Name must be at least 2 characters."
  if (name.length > 200) return "Name is too long."
  if (!slug) return "Slug is required."
  if (!SLUG_PATTERN.test(slug)) {
    return "Slug must be lowercase letters, numbers, and hyphens (e.g. max-ice-center)."
  }
  if (slug.length > 80) return "Slug is too long."
  return null
}

export async function createFacility(
  rawInput: CreateInput
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return { ok: false, error: auth.error }

  const validationError = validateCreate(rawInput)
  if (validationError) return { ok: false, error: validationError }

  const name = normalizeName(rawInput.name)
  const slug = normalizeSlug(rawInput.slug)
  const timezone = normalizeTimezone(rawInput.timezone)

  const supabase = await createClient()

  // Atomically creates the facility and seeds canonical system roles in one
  // transaction. Replaces the previous two-step approach that could leave an
  // orphaned facility if the roles upsert failed.
  const { data: facilityId, error } = await supabase.rpc(
    "create_facility_with_roles",
    {
      p_name: name,
      p_slug: slug,
      p_timezone: timezone,
      p_address: rawInput.address ?? null,
      p_zip_code: rawInput.zip_code ?? null,
      p_phone: rawInput.phone ?? null,
    },
  )

  if (error || !facilityId) {
    return {
      ok: false,
      error: describeDbError(error, "Failed to create facility."),
    }
  }

  revalidatePath("/admin/facility")
  return { ok: true, data: { id: facilityId } }
}

export async function updateFacility(
  id: string,
  input: UpdateInput
): Promise<ActionResult> {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return { ok: false, error: auth.error }

  if (!id || typeof id !== "string") {
    return { ok: false, error: "Missing facility id." }
  }

  const patch: {
    name?: string
    slug?: string
    timezone?: string
    is_active?: boolean
    address?: string | null
    zip_code?: string | null
    phone?: string | null
  } = {}

  if (typeof input.name === "string") {
    const name = normalizeName(input.name)
    if (name.length < 2) return { ok: false, error: "Name is too short." }
    patch.name = name
  }
  if (typeof input.slug === "string") {
    const slug = normalizeSlug(input.slug)
    if (!SLUG_PATTERN.test(slug)) {
      return {
        ok: false,
        error:
          "Slug must be lowercase letters, numbers, and hyphens (e.g. max-ice-center).",
      }
    }
    patch.slug = slug
  }
  if (typeof input.timezone === "string") {
    patch.timezone = normalizeTimezone(input.timezone)
  }
  if (typeof input.is_active === "boolean") {
    patch.is_active = input.is_active
  }
  if ("address" in input) {
    patch.address = input.address ?? null
  }
  if ("zip_code" in input) {
    patch.zip_code = input.zip_code ?? null
  }
  if ("phone" in input) {
    patch.phone = input.phone ?? null
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "Nothing to update." }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("facilities")
    .update(patch)
    .eq("id", id)

  if (error) {
    return { ok: false, error: describeDbError(error, "Update failed.") }
  }

  revalidatePath("/admin/facility")
  return { ok: true }
}

export async function deactivateFacility(id: string): Promise<ActionResult> {
  return updateFacility(id, { is_active: false })
}

export async function reactivateFacility(id: string): Promise<ActionResult> {
  return updateFacility(id, { is_active: true })
}
