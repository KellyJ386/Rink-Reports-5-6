"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { zipToTimezone } from "@/lib/zip-timezone"

import { isValidTimezone } from "@/app/admin/lists/types"

import {
  DEFAULT_TIMEZONE,
  SLUG_PATTERN,
  type ActionResult,
  type FacilityFieldName,
  type FacilityFormInput,
} from "./types"

type FieldErrors = Partial<Record<FacilityFieldName, string>>

function validationFail(fieldErrors: FieldErrors): {
  ok: false
  error: string
  fieldErrors: FieldErrors
} {
  // First fieldError doubles as the legacy top-level `error` string —
  // consumers that haven't adopted fieldErrors still see a useful
  // message in their <FormError> banner.
  const first = Object.values(fieldErrors)[0] ?? "Validation failed."
  return { ok: false, error: first, fieldErrors }
}

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

function resolveTimezone(
  input: string,
  zipCode: string | null | undefined,
): string {
  const tz = input.trim()
  // The picker is a per-facility, admin-editable convenience list
  // (/admin/lists). Accept any valid IANA zone the runtime recognizes rather
  // than restricting to a hardcoded set. When no valid zone was submitted,
  // derive one from the zip code (the zip drives the facility's timezone —
  // see src/lib/zip-timezone.ts) before falling back to the default.
  if (tz && isValidTimezone(tz)) return tz
  return zipToTimezone(zipCode) ?? DEFAULT_TIMEZONE
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

function validateCreate(input: CreateInput): FieldErrors {
  const errors: FieldErrors = {}
  const name = normalizeName(input.name)
  const slug = normalizeSlug(input.slug)
  if (name.length < 2) errors.name = "Name must be at least 2 characters."
  else if (name.length > 200) errors.name = "Name is too long."
  if (!slug) errors.slug = "Slug is required."
  else if (!SLUG_PATTERN.test(slug))
    errors.slug =
      "Slug must be lowercase letters, numbers, and hyphens (e.g. max-ice-center)."
  else if (slug.length > 80) errors.slug = "Slug is too long."
  const email = normalizeEmail(input.email)
  if (email && !EMAIL_PATTERN.test(email))
    errors.email = "Email must be a valid address."
  return errors
}

export async function createFacility(
  rawInput: CreateInput
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return { ok: false, error: auth.error }

  const fieldErrors = validateCreate(rawInput)
  if (Object.keys(fieldErrors).length > 0) return validationFail(fieldErrors)

  const name = normalizeName(rawInput.name)
  const slug = normalizeSlug(rawInput.slug)
  const timezone = resolveTimezone(rawInput.timezone, rawInput.zip_code)
  const email = normalizeEmail(rawInput.email)

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
      p_address: rawInput.address ?? undefined,
      p_zip_code: rawInput.zip_code ?? undefined,
      p_phone: rawInput.phone ?? undefined,
    },
  )

  if (error || !facilityId) {
    // 23505 on the slug uniqueness constraint is the common operator
    // error — surface it as a field-level message so the slug input
    // gets the aria-invalid treatment, not just a banner.
    if (error?.code === "23505") {
      return validationFail({
        slug: "That slug is already taken. Pick a unique slug.",
      })
    }
    return {
      ok: false,
      error: describeDbError(error, "Failed to create facility."),
    }
  }

  // The RPC's signature predates the city/state/email columns. Patch those in
  // a follow-up update so the new facility row carries them.
  if (rawInput.city != null || rawInput.state != null || email != null) {
    const { error: patchError } = await supabase
      .from("facilities")
      .update({
        city: rawInput.city ?? null,
        state: normalizeState(rawInput.state),
        email,
      })
      .eq("id", facilityId)
    if (patchError) {
      return {
        ok: false,
        error: describeDbError(patchError, "Facility created, but contact details failed to save."),
      }
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
    city?: string | null
    state?: string | null
    zip_code?: string | null
    phone?: string | null
    email?: string | null
  } = {}

  const fieldErrors: FieldErrors = {}
  if (typeof input.name === "string") {
    const name = normalizeName(input.name)
    if (name.length < 2) fieldErrors.name = "Name is too short."
    else patch.name = name
  }
  if (typeof input.slug === "string") {
    const slug = normalizeSlug(input.slug)
    if (!SLUG_PATTERN.test(slug))
      fieldErrors.slug =
        "Slug must be lowercase letters, numbers, and hyphens (e.g. max-ice-center)."
    else patch.slug = slug
  }
  if ("email" in input) {
    const email = normalizeEmail(input.email)
    if (email && !EMAIL_PATTERN.test(email))
      fieldErrors.email = "Email must be a valid address."
    else patch.email = email
  }
  if (Object.keys(fieldErrors).length > 0) return validationFail(fieldErrors)

  if (typeof input.timezone === "string") {
    patch.timezone = resolveTimezone(
      input.timezone,
      "zip_code" in input ? input.zip_code : null,
    )
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

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "Nothing to update." }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("facilities")
    .update(patch)
    .eq("id", id)

  if (error) {
    if (error.code === "23505") {
      return validationFail({
        slug: "That slug is already taken. Pick a unique slug.",
      })
    }
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
