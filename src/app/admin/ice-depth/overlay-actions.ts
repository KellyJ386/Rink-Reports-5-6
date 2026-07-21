"use server"

// Server actions for the Ice Depth rink-diagram overlays (door types, door
// markers, center-ice logo watermark). Same conventions as ./actions.ts:
//
//  * facility_id is ALWAYS derived server-side from the caller's session
//    (resolveFacility) — never accepted from the client.
//  * Every action re-checks the module-scoped ice_depth admin grant
//    (ensureIceDepthAdmin) — authorization lives here and in RLS, not in the
//    UI. RLS (migration 199) enforces the same gate as defense in depth.
//  * Table writes go through the USER client so RLS applies. Only the storage
//    object put/remove uses the service-role client (the rink-logos bucket is
//    write-locked to service-role, mirroring facility-documents), and only
//    AFTER the admin gate has passed.

import { randomUUID } from "node:crypto"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { currentUserCan } from "@/lib/permissions/check"
import { logServerError } from "@/lib/observability/log-server-error"
import {
  MAX_RINK_LOGO_BYTES,
  clamp01,
  isAllowedRinkLogoExtension,
  normalizeLogoLayout,
  rinkLogoExtension,
  rinkLogoMimeType,
} from "@/lib/ice-depth/overlay-shared"
import { RINK_LOGO_BUCKET } from "@/lib/ice-depth/overlays"

import type { ActionState, SimpleResult } from "./types"

type SupabaseError = { code?: string; message?: string } | null

const HEX_RE = /^#[0-9a-fA-F]{6}$/

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

/**
 * Guard shared with ./actions.ts (kept file-local there too — helpers must
 * not be exported from a "use server" module). requireAdmin() covers console
 * access; the overlay tables' RLS write policies additionally gate on
 * has_module_admin_access('ice_depth'), so check the module grant up front
 * and return a readable denial instead of an opaque RLS error.
 */
async function ensureIceDepthAdmin(): Promise<string | null> {
  await requireAdmin()
  const supabase = await createClient()
  const allowed = await currentUserCan(supabase, "ice_depth", "admin")
  return allowed
    ? null
    : "Your account has admin console access but not the ice depth module's admin permission. Ask an administrator to grant it under Admin → Permissions."
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

type UserClient = Awaited<ReturnType<typeof createClient>>

/** Acting employee for created_by/updated_by attribution (nullable). */
async function resolveEmployeeId(
  supabase: UserClient,
  facilityId: string,
): Promise<string | null> {
  const current = await getCurrentUser()
  const userId = current?.authUser?.id
  if (!userId) return null
  const { data } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", userId)
    .eq("facility_id", facilityId)
    .eq("is_active", true)
    .maybeSingle()
  return data?.id ?? null
}

function revalidate() {
  revalidatePath("/admin/ice-depth")
  revalidatePath("/reports/ice-depth")
}

// ============================================================================
// Door types (admin-configurable lookup — DB rows, never a code enum)
// ============================================================================

export async function upsertDoorType(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const denied = await ensureIceDepthAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const id = nonEmpty(formData.get("id"))
    const name = nonEmpty(formData.get("name"))
    if (!name) return { ok: false, error: "Name is required." }
    const color = nonEmpty(formData.get("color"))
    if (color && !HEX_RE.test(color)) {
      return { ok: false, error: "Color must be 6-digit hex (e.g. #002244)." }
    }
    const sort_order = asInt(formData.get("sort_order"))

    const supabase = await createClient()

    if (id) {
      const { data, error } = await supabase
        .from("facility_door_types")
        .update({
          name: name.slice(0, 100),
          color,
          ...(sort_order !== null ? { sort_order } : {}),
        })
        .eq("id", id)
        .eq("facility_id", facility.facilityId)
        .select("id")
      if (error) {
        return { ok: false, error: dbError(error, "Failed to update door type.") }
      }
      if (!data || data.length === 0) {
        return { ok: false, error: "Door type not found." }
      }
      revalidate()
      return { ok: true, message: "Door type updated." }
    }

    const created_by = await resolveEmployeeId(supabase, facility.facilityId)
    const { error } = await supabase.from("facility_door_types").insert({
      facility_id: facility.facilityId,
      name: name.slice(0, 100),
      color,
      sort_order: sort_order ?? 0,
      created_by,
    })
    if (error) {
      if (error.code === "23505") {
        return { ok: false, error: "A door type with that name already exists." }
      }
      return { ok: false, error: dbError(error, "Failed to create door type.") }
    }
    revalidate()
    return { ok: true, message: "Door type created." }
  } catch (e) {
    logServerError("admin/ice-depth/overlay-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function setDoorTypeActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    const denied = await ensureIceDepthAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing door type id." }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("facility_door_types")
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("id")
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update door type.") }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Door type not found." }
    }
    revalidate()
    return { ok: true }
  } catch (e) {
    logServerError("admin/ice-depth/overlay-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteDoorType(id: string): Promise<SimpleResult> {
  try {
    const denied = await ensureIceDepthAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing door type id." }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("facility_door_types")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("id")
    if (error) {
      if (error.code === "23503") {
        return {
          ok: false,
          error:
            "Door markers still use this type. Delete those markers first, or deactivate the type instead.",
        }
      }
      return { ok: false, error: dbError(error, "Failed to delete door type.") }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Door type not found." }
    }
    revalidate()
    return { ok: true }
  } catch (e) {
    logServerError("admin/ice-depth/overlay-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Door markers
// ============================================================================

export async function upsertDoorMarker(input: {
  id?: string
  door_type_id: string
  label?: string | null
  position_x: number
  position_y: number
}): Promise<SimpleResult> {
  try {
    const denied = await ensureIceDepthAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    if (!input.door_type_id) {
      return { ok: false, error: "Pick a door type first." }
    }
    if (
      !Number.isFinite(input.position_x) ||
      !Number.isFinite(input.position_y)
    ) {
      return { ok: false, error: "Invalid coordinates." }
    }
    const position_x = clamp01(input.position_x)
    const position_y = clamp01(input.position_y)
    const label =
      typeof input.label === "string"
        ? input.label.trim().slice(0, 200) || null
        : null

    const supabase = await createClient()

    // Confirm the type belongs to this facility (the composite FK enforces it
    // too, but this returns a readable error instead of a constraint message).
    const { data: doorType } = await supabase
      .from("facility_door_types")
      .select("id")
      .eq("id", input.door_type_id)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    if (!doorType) return { ok: false, error: "Door type not found." }

    const employeeId = await resolveEmployeeId(supabase, facility.facilityId)

    if (input.id) {
      const { data, error } = await supabase
        .from("facility_door_markers")
        .update({
          door_type_id: input.door_type_id,
          label,
          position_x,
          position_y,
          updated_by: employeeId,
        })
        .eq("id", input.id)
        .eq("facility_id", facility.facilityId)
        .select("id")
      if (error) {
        return { ok: false, error: dbError(error, "Failed to update marker.") }
      }
      if (!data || data.length === 0) {
        return { ok: false, error: "Marker not found." }
      }
      revalidate()
      return { ok: true }
    }

    const { error } = await supabase.from("facility_door_markers").insert({
      facility_id: facility.facilityId,
      door_type_id: input.door_type_id,
      label,
      position_x,
      position_y,
      created_by: employeeId,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to add marker.") }
    }
    revalidate()
    return { ok: true }
  } catch (e) {
    logServerError("admin/ice-depth/overlay-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteDoorMarker(id: string): Promise<SimpleResult> {
  try {
    const denied = await ensureIceDepthAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing marker id." }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("facility_door_markers")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("id")
    if (error) {
      return { ok: false, error: dbError(error, "Failed to delete marker.") }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Marker not found." }
    }
    revalidate()
    return { ok: true }
  } catch (e) {
    logServerError("admin/ice-depth/overlay-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Seed defaults (existing facilities — new ones seed via the DB trigger)
//
// The DB has a SECURITY DEFINER seed_default_door_types(uuid) but it's
// service_role only, so replicate the insert inline under the admin's session
// (RLS-gated). Idempotent via the (facility_id, name) unique constraint.
// ============================================================================

export async function seedDefaultDoorTypes(): Promise<SimpleResult> {
  try {
    const denied = await ensureIceDepthAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const supabase = await createClient()
    const { error } = await supabase.from("facility_door_types").upsert(
      [
        { facility_id: facility.facilityId, name: "Zamboni Door", sort_order: 0 },
        { facility_id: facility.facilityId, name: "Access Door", sort_order: 1 },
        { facility_id: facility.facilityId, name: "Player Gate", sort_order: 2 },
        { facility_id: facility.facilityId, name: "Penalty Box Gate", sort_order: 3 },
      ],
      { onConflict: "facility_id,name", ignoreDuplicates: true },
    )
    if (error) {
      return { ok: false, error: dbError(error, "Failed to seed door types.") }
    }
    revalidate()
    return { ok: true }
  } catch (e) {
    logServerError("admin/ice-depth/overlay-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Center-ice logo watermark
// ============================================================================

export async function updateRinkLogoLayout(patch: {
  position_x?: number
  position_y?: number
  scale?: number
  rotation?: number
  opacity?: number
  visible?: boolean
}): Promise<SimpleResult> {
  try {
    const denied = await ensureIceDepthAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const layout = normalizeLogoLayout(patch)
    const update: typeof layout & { logo_visible?: boolean } = { ...layout }
    if (typeof patch.visible === "boolean") update.logo_visible = patch.visible
    if (Object.keys(update).length === 0) return { ok: true }

    const supabase = await createClient()
    const updated_by = await resolveEmployeeId(supabase, facility.facilityId)
    // Upsert so layout tweaks work even before a logo is uploaded (the row
    // then simply waits for a logo_storage_path).
    const { error } = await supabase.from("facility_rink_diagram_config").upsert(
      {
        facility_id: facility.facilityId,
        ...update,
        updated_by,
      },
      { onConflict: "facility_id" },
    )
    if (error) {
      return { ok: false, error: dbError(error, "Failed to save logo layout.") }
    }
    revalidate()
    return { ok: true }
  } catch (e) {
    logServerError("admin/ice-depth/overlay-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function uploadRinkLogo(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const denied = await ensureIceDepthAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const file = formData.get("file")
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Choose a logo file to upload." }
    }
    const ext = rinkLogoExtension(file.name)
    if (!isAllowedRinkLogoExtension(ext)) {
      return {
        ok: false,
        error: "Unsupported file type. Use PNG, SVG, or WebP (with transparency).",
      }
    }
    if (file.size > MAX_RINK_LOGO_BYTES) {
      return { ok: false, error: "Logo exceeds the 2 MB limit." }
    }

    const supabase = await createClient()
    const { data: existing } = await supabase
      .from("facility_rink_diagram_config")
      .select("logo_storage_path")
      .eq("facility_id", facility.facilityId)
      .maybeSingle()

    // Unique object name per upload: replacing the logo can never serve a
    // stale CDN-cached image, and the old object is removed after the swap.
    const storagePath = `${facility.facilityId}/rink-logo-${randomUUID()}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())
    const admin = createAdminClient()

    const { error: uploadErr } = await admin.storage
      .from(RINK_LOGO_BUCKET)
      .upload(storagePath, buffer, {
        contentType: rinkLogoMimeType(ext),
        upsert: false,
      })
    if (uploadErr) {
      return { ok: false, error: `Upload failed: ${uploadErr.message}` }
    }

    // Config write goes through the USER client so RLS re-checks the
    // module-admin grant even though the object write used service-role.
    const updated_by = await resolveEmployeeId(supabase, facility.facilityId)
    const { error: dbErr } = await supabase
      .from("facility_rink_diagram_config")
      .upsert(
        {
          facility_id: facility.facilityId,
          logo_storage_path: storagePath,
          updated_by,
        },
        { onConflict: "facility_id" },
      )
    if (dbErr) {
      // Roll back the orphaned object so a retry starts clean.
      await admin.storage.from(RINK_LOGO_BUCKET).remove([storagePath])
      return { ok: false, error: dbError(dbErr, "Failed to save logo.") }
    }

    // Best-effort: drop the replaced object (config already points elsewhere).
    const oldPath = existing?.logo_storage_path
    if (oldPath && oldPath !== storagePath) {
      await admin.storage.from(RINK_LOGO_BUCKET).remove([oldPath])
    }

    revalidate()
    return { ok: true, message: "Logo uploaded." }
  } catch (e) {
    logServerError("admin/ice-depth/overlay-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function removeRinkLogo(): Promise<SimpleResult> {
  try {
    const denied = await ensureIceDepthAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const supabase = await createClient()
    const { data: existing } = await supabase
      .from("facility_rink_diagram_config")
      .select("id, logo_storage_path")
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    if (!existing) return { ok: true }

    const updated_by = await resolveEmployeeId(supabase, facility.facilityId)
    const { data, error } = await supabase
      .from("facility_rink_diagram_config")
      .update({ logo_storage_path: null, updated_by })
      .eq("facility_id", facility.facilityId)
      .select("id")
    if (error) {
      return { ok: false, error: dbError(error, "Failed to remove logo.") }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Logo config not found." }
    }

    // Best-effort object cleanup — the config row no longer references it.
    if (existing.logo_storage_path) {
      const admin = createAdminClient()
      await admin.storage
        .from(RINK_LOGO_BUCKET)
        .remove([existing.logo_storage_path])
    }

    revalidate()
    return { ok: true }
  } catch (e) {
    logServerError("admin/ice-depth/overlay-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}
