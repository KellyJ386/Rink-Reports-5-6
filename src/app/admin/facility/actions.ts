"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import {
  CANONICAL_ROLES,
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
  city?: string | null
  state?: string | null
  zip_code?: string | null
  phone?: string | null
  email?: string | null
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeEmail(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null
  const trimmed = input.trim()
  if (!trimmed) return null
  return trimmed
}

function normalizeState(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null
  const trimmed = input.trim().toUpperCase()
  if (!trimmed) return null
  return trimmed
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
  const email = normalizeEmail(rawInput.email)
  if (email && !EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "Email must be a valid address." }
  }

  const supabase = await createClient()

  const { data: facility, error: insertError } = await supabase
    .from("facilities")
    .insert({
      name,
      slug,
      timezone,
      address: rawInput.address ?? null,
      city: rawInput.city ?? null,
      state: normalizeState(rawInput.state),
      zip_code: rawInput.zip_code ?? null,
      phone: rawInput.phone ?? null,
      email,
    })
    .select("id")
    .single()

  if (insertError || !facility) {
    return {
      ok: false,
      error: describeDbError(insertError, "Failed to create facility."),
    }
  }

  // Seed roles inline (the RPC is restricted to service_role).
  const roleRows = CANONICAL_ROLES.map((role) => ({
    facility_id: facility.id,
    key: role.key,
    display_name: role.display_name,
    hierarchy_level: role.hierarchy_level,
    is_system: true,
  }))

  const { error: rolesError } = await supabase
    .from("roles")
    .upsert(roleRows, { onConflict: "facility_id,key" })

  if (rolesError) {
    return {
      ok: false,
      error: `Facility created, but seeding default roles failed: ${rolesError.message}`,
    }
  }

  revalidatePath("/admin/facility")
  return { ok: true, data: { id: facility.id } }
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
    city?: string | null
    state?: string | null
    zip_code?: string | null
    phone?: string | null
    email?: string | null
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
  if ("city" in input) {
    patch.city = input.city ?? null
  }
  if ("state" in input) {
    patch.state = normalizeState(input.state)
  }
  if ("zip_code" in input) {
    patch.zip_code = input.zip_code ?? null
  }
  if ("phone" in input) {
    patch.phone = input.phone ?? null
  }
  if ("email" in input) {
    const email = normalizeEmail(input.email)
    if (email && !EMAIL_PATTERN.test(email)) {
      return { ok: false, error: "Email must be a valid address." }
    }
    patch.email = email
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
