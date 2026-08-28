"use server"

import { createHash, randomBytes } from "node:crypto"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { currentUserCan } from "@/lib/permissions/check"
import { logServerError } from "@/lib/observability/log-server-error"
import { createClient } from "@/lib/supabase/server"

import {
  MAX_ACTIVE_RINKS,
  isHexColor,
  normalizeShortCode,
  parseTaxRatePercent,
  parseTimeToMinutes,
  slugify,
  validateHoursRow,
  validateSettings,
} from "./_lib/config"
import type { ActionState, CreatedToken, SimpleResult } from "./types"

const ADMIN_PATH = "/admin/rink-scheduling"

// ---------------------------------------------------------------------------
// Error mapping
//
// A local dbError rather than the shared @/lib/db-error, which the shared
// helper's own doc comment sanctions for exactly this case: migration 247
// leans hard on CHECK constraints (23514) and adds the booking overlap
// EXCLUSION constraint (23P01), neither of which the shared mapper words
// usefully. A raw "new row violates check constraint
// rink_scheduling_settings_slot_chk" is not something an admin can act on.
// ---------------------------------------------------------------------------
type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  if (err.code === "23505") {
    return "That name or code is already in use here. Pick another."
  }
  if (err.code === "23503") {
    return "Cannot complete: something still references this record. Deactivate it instead."
  }
  if (err.code === "23514") {
    return `${fallback} A value was outside the range this field allows.`
  }
  if (err.code === "23P01") {
    // Only reachable from this module's booking/rate-card exclusion
    // constraints. Phase 3 translates booking conflicts into a resolution UI;
    // here it can only be an overlapping default rate card.
    return "That change overlaps an existing record. Adjust the dates so they do not overlap."
  }
  if (err.code === "P0001") return err.message?.trim() || fallback
  return err.message?.trim() || fallback
}

// ---------------------------------------------------------------------------
// Guards
//
// facility_id is ALWAYS derived from the authenticated session here and never
// read from the client. Every write additionally carries
// .eq("facility_id", facility.facilityId) as belt-and-braces over RLS.
// ---------------------------------------------------------------------------

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

/**
 * Console access is not the same grant as module access. Writes here are
 * RLS-gated on has_module_edit_access('rink_scheduling'), and an RLS-filtered
 * UPDATE returns zero rows WITHOUT an error — so a user with the console but
 * not the module would watch every save succeed silently and change nothing.
 * Checking up front turns that into a sentence.
 */
async function ensureFacilityManager(): Promise<
  { ok: true; facilityId: string } | { ok: false; error: string }
> {
  await requireAdmin()
  const facility = await resolveFacility()
  if (!facility.ok) return facility

  const supabase = await createClient()
  const allowed = await currentUserCan(supabase, "rink_scheduling", "edit")
  if (!allowed) {
    return {
      ok: false,
      error:
        "Your account has admin console access but not the Rink Scheduling edit permission. Ask a super admin to grant it in Permissions.",
    }
  }
  return { ok: true, facilityId: facility.facilityId }
}

/** Rate cards and module settings are the org_admin tier per the module's RBAC
 *  matrix, so they need the module-scoped `admin` grant, not `edit`. */
async function ensureModuleAdmin(): Promise<
  { ok: true; facilityId: string } | { ok: false; error: string }
> {
  await requireAdmin()
  const facility = await resolveFacility()
  if (!facility.ok) return facility

  const supabase = await createClient()
  const allowed = await currentUserCan(supabase, "rink_scheduling", "admin")
  if (!allowed) {
    return {
      ok: false,
      error:
        "Rate cards and module settings need the Rink Scheduling admin permission. Ask a super admin to grant it in Permissions.",
    }
  }
  return { ok: true, facilityId: facility.facilityId }
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

function asMoney(value: FormDataEntryValue | null): number | null {
  const s = nonEmpty(value)
  if (s === null) return null
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return null
  return Number(n.toFixed(2))
}

function fail(error: string): ActionState {
  return { ok: false, error }
}

function caught(e: unknown): ActionState {
  logServerError("admin/rink-scheduling/actions", e)
  return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
}

function caughtSimple(e: unknown): SimpleResult {
  logServerError("admin/rink-scheduling/actions", e)
  return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
}


/**
 * Operating hours and the coverage toggle both change what "covered" means, so
 * editing them re-checks every future booking. Best-effort: a queue failure
 * must not fail the save, and the cron sweep runs on its own schedule anyway.
 */
async function enqueueCoverageRecheck(
  facilityId: string,
  reason: "hours_change" | "settings_change",
): Promise<void> {
  try {
    const supabase = await createClient()
    await supabase
      .from("rink_coverage_reeval_queue")
      .insert({ facility_id: facilityId, reason, status: "pending" })
  } catch {
    // Intentionally swallowed.
  }
}

// ===========================================================================
// RINKS
// ===========================================================================

/**
 * The 10-active-rink cap lives here rather than in a database constraint on
 * purpose: it is a product rule about how many columns the calendar can carry,
 * not a data invariant. A table constraint would also have to be satisfied by
 * every future backfill and would make dropping BACK below the cap awkward.
 * Reactivating is checked too, since that is the other way to exceed it.
 */
async function activeRinkCount(facilityId: string, excludeId?: string): Promise<number> {
  const supabase = await createClient()
  let q = supabase
    .from("facility_rinks")
    .select("id", { count: "exact", head: true })
    .eq("facility_id", facilityId)
    .eq("is_active", true)
  if (excludeId) q = q.neq("id", excludeId)
  const { count } = await q
  return count ?? 0
}

export async function createRink(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const facility = await ensureFacilityManager()
    if (!facility.ok) return fail(facility.error)

    const name = nonEmpty(formData.get("name"))
    if (!name) return fail("Rink name is required.")

    const shortCode = normalizeShortCode(String(formData.get("short_code") ?? ""))
    if (!shortCode) {
      return fail("Short code is required — it is what the TV display shows.")
    }

    const color = nonEmpty(formData.get("display_color")) ?? "#4DFF00"
    if (!isHexColor(color)) return fail("Colour must look like #4DFF00.")

    const active = await activeRinkCount(facility.facilityId)
    if (active >= MAX_ACTIVE_RINKS) {
      return fail(
        `This facility already has ${MAX_ACTIVE_RINKS} active rinks, which is the maximum. Deactivate one before adding another.`,
      )
    }

    const supabase = await createClient()
    const { error } = await supabase.from("facility_rinks").insert({
      facility_id: facility.facilityId,
      name,
      slug: slugify(name),
      short_code: shortCode,
      display_color: color,
      sort_order: asInt(formData.get("sort_order")) ?? active,
      is_active: true,
    })
    if (error) return fail(dbError(error, "Failed to create rink."))

    revalidatePath(ADMIN_PATH)
    return { ok: true, message: "Rink created." }
  } catch (e) {
    return caught(e)
  }
}

export async function updateRink(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const facility = await ensureFacilityManager()
    if (!facility.ok) return fail(facility.error)

    const id = nonEmpty(formData.get("id"))
    if (!id) return fail("Missing rink id.")

    const name = nonEmpty(formData.get("name"))
    if (!name) return fail("Rink name is required.")

    const shortCode = normalizeShortCode(String(formData.get("short_code") ?? ""))
    if (!shortCode) return fail("Short code is required.")

    const color = nonEmpty(formData.get("display_color")) ?? "#4DFF00"
    if (!isHexColor(color)) return fail("Colour must look like #4DFF00.")

    const supabase = await createClient()
    const { error } = await supabase
      .from("facility_rinks")
      .update({
        name,
        slug: slugify(name),
        short_code: shortCode,
        display_color: color,
        ...(asInt(formData.get("sort_order")) !== null
          ? { sort_order: asInt(formData.get("sort_order")) as number }
          : {}),
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) return fail(dbError(error, "Failed to update rink."))

    revalidatePath(ADMIN_PATH)
    return { ok: true, message: "Rink updated." }
  } catch (e) {
    return caught(e)
  }
}

export async function setRinkActive(
  id: string,
  active: boolean,
): Promise<SimpleResult> {
  try {
    const facility = await ensureFacilityManager()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing rink id." }

    // Re-activating is the other route past the cap.
    if (active) {
      const count = await activeRinkCount(facility.facilityId, id)
      if (count >= MAX_ACTIVE_RINKS) {
        return {
          ok: false,
          error: `That would exceed the maximum of ${MAX_ACTIVE_RINKS} active rinks. Deactivate another first.`,
        }
      }
    }

    const supabase = await createClient()
    const { error } = await supabase
      .from("facility_rinks")
      .update({ is_active: active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) return { ok: false, error: dbError(error, "Failed to update rink.") }

    revalidatePath(ADMIN_PATH)
    return { ok: true }
  } catch (e) {
    return caughtSimple(e)
  }
}

export async function deleteRink(id: string): Promise<SimpleResult> {
  try {
    const facility = await ensureFacilityManager()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing rink id." }

    const supabase = await createClient()
    const { error } = await supabase
      .from("facility_rinks")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      if (error.code === "23503") {
        return {
          ok: false,
          error: "This rink has bookings. Deactivate it instead of deleting.",
        }
      }
      return { ok: false, error: dbError(error, "Failed to delete rink.") }
    }

    revalidatePath(ADMIN_PATH)
    return { ok: true }
  } catch (e) {
    return caughtSimple(e)
  }
}

// ===========================================================================
// LOCKER ROOMS
// ===========================================================================

export async function createLockerRoom(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const facility = await ensureFacilityManager()
    if (!facility.ok) return fail(facility.error)

    const name = nonEmpty(formData.get("name"))
    if (!name) return fail("Locker room name is required.")

    const shortCode = normalizeShortCode(String(formData.get("short_code") ?? ""))
    if (!shortCode) return fail("Short code is required — the TV display uses it.")

    const capacity = asInt(formData.get("capacity"))
    if (capacity !== null && (capacity < 1 || capacity > 500)) {
      return fail("Capacity must be between 1 and 500, or left blank.")
    }

    const supabase = await createClient()
    const { error } = await supabase.from("facility_locker_rooms").insert({
      facility_id: facility.facilityId,
      name,
      slug: slugify(name),
      short_code: shortCode,
      capacity,
      default_rink_id: nonEmpty(formData.get("default_rink_id")),
      notes: nonEmpty(formData.get("notes")),
      sort_order: asInt(formData.get("sort_order")) ?? 0,
      is_active: true,
    })
    if (error) return fail(dbError(error, "Failed to create locker room."))

    revalidatePath(ADMIN_PATH)
    return { ok: true, message: "Locker room created." }
  } catch (e) {
    return caught(e)
  }
}

export async function updateLockerRoom(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const facility = await ensureFacilityManager()
    if (!facility.ok) return fail(facility.error)

    const id = nonEmpty(formData.get("id"))
    if (!id) return fail("Missing locker room id.")

    const name = nonEmpty(formData.get("name"))
    if (!name) return fail("Locker room name is required.")

    const shortCode = normalizeShortCode(String(formData.get("short_code") ?? ""))
    if (!shortCode) return fail("Short code is required.")

    const capacity = asInt(formData.get("capacity"))
    if (capacity !== null && (capacity < 1 || capacity > 500)) {
      return fail("Capacity must be between 1 and 500, or left blank.")
    }

    const supabase = await createClient()
    const { error } = await supabase
      .from("facility_locker_rooms")
      .update({
        name,
        slug: slugify(name),
        short_code: shortCode,
        capacity,
        default_rink_id: nonEmpty(formData.get("default_rink_id")),
        notes: nonEmpty(formData.get("notes")),
        ...(asInt(formData.get("sort_order")) !== null
          ? { sort_order: asInt(formData.get("sort_order")) as number }
          : {}),
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) return fail(dbError(error, "Failed to update locker room."))

    revalidatePath(ADMIN_PATH)
    return { ok: true, message: "Locker room updated." }
  } catch (e) {
    return caught(e)
  }
}

export async function setLockerRoomActive(
  id: string,
  active: boolean,
): Promise<SimpleResult> {
  try {
    const facility = await ensureFacilityManager()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing locker room id." }

    const supabase = await createClient()
    const { error } = await supabase
      .from("facility_locker_rooms")
      .update({ is_active: active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update locker room.") }
    }

    revalidatePath(ADMIN_PATH)
    return { ok: true }
  } catch (e) {
    return caughtSimple(e)
  }
}

export async function deleteLockerRoom(id: string): Promise<SimpleResult> {
  try {
    const facility = await ensureFacilityManager()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing locker room id." }

    const supabase = await createClient()
    const { error } = await supabase
      .from("facility_locker_rooms")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      if (error.code === "23503") {
        return {
          ok: false,
          error:
            "This locker room is assigned to bookings. Deactivate it instead of deleting.",
        }
      }
      return { ok: false, error: dbError(error, "Failed to delete locker room.") }
    }

    revalidatePath(ADMIN_PATH)
    return { ok: true }
  } catch (e) {
    return caughtSimple(e)
  }
}

// ===========================================================================
// OPERATING HOURS
// ===========================================================================

/**
 * The weekly grid saves as one form: seven rows, each either closed or a
 * time pair. Saved with a single upsert on (facility_id, day_of_week) so a
 * facility that has never saved hours and one that is editing them take the
 * same path.
 */
export async function saveOperatingHours(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const facility = await ensureFacilityManager()
    if (!facility.ok) return fail(facility.error)

    const rows: {
      facility_id: string
      day_of_week: number
      open_time: string | null
      close_time: string | null
      is_closed: boolean
    }[] = []

    for (let day = 0; day < 7; day++) {
      const isClosed = formData.get(`closed_${day}`) === "on"
      const openTime = String(formData.get(`open_${day}`) ?? "")
      const closeTime = String(formData.get(`close_${day}`) ?? "")

      const problem = validateHoursRow({
        dayOfWeek: day,
        isClosed,
        openTime,
        closeTime,
      })
      if (problem) return fail(problem)

      rows.push({
        facility_id: facility.facilityId,
        day_of_week: day,
        open_time: isClosed ? null : openTime,
        close_time: isClosed ? null : closeTime,
        is_closed: isClosed,
      })
    }

    const supabase = await createClient()
    const { error } = await supabase
      .from("facility_operating_hours")
      .upsert(rows, { onConflict: "facility_id,day_of_week" })
    if (error) return fail(dbError(error, "Failed to save operating hours."))

    await enqueueCoverageRecheck(facility.facilityId, "hours_change")
    revalidatePath(ADMIN_PATH)
    return { ok: true, message: "Operating hours saved." }
  } catch (e) {
    return caught(e)
  }
}

export async function createHoursException(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const facility = await ensureFacilityManager()
    if (!facility.ok) return fail(facility.error)

    const date = nonEmpty(formData.get("exception_date"))
    if (!date) return fail("Pick a date for the exception.")

    const label = nonEmpty(formData.get("label"))
    if (!label) return fail("Give the exception a label, e.g. “Thanksgiving”.")

    const isClosed = formData.get("is_closed") === "on"
    const openTime = String(formData.get("open_time") ?? "")
    const closeTime = String(formData.get("close_time") ?? "")

    if (!isClosed) {
      if (parseTimeToMinutes(openTime) === null) {
        return fail("Opening time must look like 09:00, or mark the day closed.")
      }
      if (parseTimeToMinutes(closeTime) === null) {
        return fail("Closing time must look like 17:00, or mark the day closed.")
      }
    }

    const supabase = await createClient()
    const { error } = await supabase
      .from("facility_operating_hours_exceptions")
      .insert({
        facility_id: facility.facilityId,
        exception_date: date,
        label,
        is_closed: isClosed,
        open_time: isClosed ? null : openTime,
        close_time: isClosed ? null : closeTime,
      })
    if (error) {
      if (error.code === "23505") {
        return fail("There is already an exception for that date. Edit or remove it first.")
      }
      return fail(dbError(error, "Failed to add the exception."))
    }

    await enqueueCoverageRecheck(facility.facilityId, "hours_change")
    revalidatePath(ADMIN_PATH)
    return { ok: true, message: "Exception added." }
  } catch (e) {
    return caught(e)
  }
}

export async function deleteHoursException(id: string): Promise<SimpleResult> {
  try {
    const facility = await ensureFacilityManager()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing exception id." }

    const supabase = await createClient()
    const { error } = await supabase
      .from("facility_operating_hours_exceptions")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to remove the exception.") }
    }

    await enqueueCoverageRecheck(facility.facilityId, "hours_change")
    revalidatePath(ADMIN_PATH)
    return { ok: true }
  } catch (e) {
    return caughtSimple(e)
  }
}

// ===========================================================================
// LOOKUP LISTS (booking types, customer types, payment methods)
//
// One generic pair of handlers over three tables that share the
// (facility_id, name, slug, sort_order, is_active) shape. The table name is
// validated against a fixed allow-list rather than trusted, so a tampered form
// field cannot redirect a write at another table.
// ===========================================================================

const LOOKUP_TABLES = {
  booking_types: "rink_booking_types",
  customer_types: "rink_customer_types",
  payment_methods: "rink_payment_methods",
} as const

type LookupKey = keyof typeof LOOKUP_TABLES

function asLookupKey(value: FormDataEntryValue | null): LookupKey | null {
  const s = typeof value === "string" ? value : ""
  return (Object.keys(LOOKUP_TABLES) as string[]).includes(s)
    ? (s as LookupKey)
    : null
}

export async function createLookup(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const facility = await ensureFacilityManager()
    if (!facility.ok) return fail(facility.error)

    const key = asLookupKey(formData.get("lookup"))
    if (!key) return fail("Unknown list.")

    const name = nonEmpty(formData.get("name"))
    if (!name) return fail("Name is required.")

    const supabase = await createClient()

    if (key === "booking_types") {
      const color = nonEmpty(formData.get("color")) ?? "#002244"
      if (!isHexColor(color)) return fail("Colour must look like #002244.")
      const { error } = await supabase.from("rink_booking_types").insert({
        facility_id: facility.facilityId,
        name,
        slug: slugify(name),
        color,
        is_billable: formData.get("is_billable") === "on",
        sort_order: asInt(formData.get("sort_order")) ?? 0,
        is_active: true,
      })
      if (error) return fail(dbError(error, "Failed to create booking type."))
    } else {
      const { error } = await supabase.from(LOOKUP_TABLES[key]).insert({
        facility_id: facility.facilityId,
        name,
        slug: slugify(name),
        sort_order: asInt(formData.get("sort_order")) ?? 0,
        is_active: true,
      })
      if (error) return fail(dbError(error, "Failed to create entry."))
    }

    revalidatePath(ADMIN_PATH)
    return { ok: true, message: "Added." }
  } catch (e) {
    return caught(e)
  }
}

export async function updateLookup(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const facility = await ensureFacilityManager()
    if (!facility.ok) return fail(facility.error)

    const key = asLookupKey(formData.get("lookup"))
    if (!key) return fail("Unknown list.")

    const id = nonEmpty(formData.get("id"))
    if (!id) return fail("Missing id.")

    const name = nonEmpty(formData.get("name"))
    if (!name) return fail("Name is required.")

    const supabase = await createClient()

    if (key === "booking_types") {
      const color = nonEmpty(formData.get("color")) ?? "#002244"
      if (!isHexColor(color)) return fail("Colour must look like #002244.")

      // A seeded system type (Maintenance Block) may be renamed and recoloured
      // but never made billable: the "customer optional" rule keys off a
      // non-billable type, so flipping it would orphan existing bookings that
      // legitimately have no customer.
      const { data: existing } = await supabase
        .from("rink_booking_types")
        .select("is_system, is_billable")
        .eq("id", id)
        .eq("facility_id", facility.facilityId)
        .maybeSingle()

      const requestedBillable = formData.get("is_billable") === "on"
      const isBillable = existing?.is_system
        ? (existing.is_billable ?? false)
        : requestedBillable

      if (existing?.is_system && requestedBillable !== existing.is_billable) {
        return fail(
          "Maintenance Block cannot be made billable — bookings of that type are allowed to have no customer.",
        )
      }

      const { error } = await supabase
        .from("rink_booking_types")
        .update({
          name,
          slug: slugify(name),
          color,
          is_billable: isBillable,
          ...(asInt(formData.get("sort_order")) !== null
            ? { sort_order: asInt(formData.get("sort_order")) as number }
            : {}),
        })
        .eq("id", id)
        .eq("facility_id", facility.facilityId)
      if (error) return fail(dbError(error, "Failed to update booking type."))
    } else {
      const { error } = await supabase
        .from(LOOKUP_TABLES[key])
        .update({
          name,
          slug: slugify(name),
          ...(asInt(formData.get("sort_order")) !== null
            ? { sort_order: asInt(formData.get("sort_order")) as number }
            : {}),
        })
        .eq("id", id)
        .eq("facility_id", facility.facilityId)
      if (error) return fail(dbError(error, "Failed to update entry."))
    }

    revalidatePath(ADMIN_PATH)
    return { ok: true, message: "Saved." }
  } catch (e) {
    return caught(e)
  }
}

export async function setLookupActive(
  lookup: string,
  id: string,
  active: boolean,
): Promise<SimpleResult> {
  try {
    const facility = await ensureFacilityManager()
    if (!facility.ok) return { ok: false, error: facility.error }

    const key = asLookupKey(lookup)
    if (!key) return { ok: false, error: "Unknown list." }
    if (!id) return { ok: false, error: "Missing id." }

    const supabase = await createClient()
    const { error } = await supabase
      .from(LOOKUP_TABLES[key])
      .update({ is_active: active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) return { ok: false, error: dbError(error, "Failed to update entry.") }

    revalidatePath(ADMIN_PATH)
    return { ok: true }
  } catch (e) {
    return caughtSimple(e)
  }
}

export async function deleteLookup(
  lookup: string,
  id: string,
): Promise<SimpleResult> {
  try {
    const facility = await ensureFacilityManager()
    if (!facility.ok) return { ok: false, error: facility.error }

    const key = asLookupKey(lookup)
    if (!key) return { ok: false, error: "Unknown list." }
    if (!id) return { ok: false, error: "Missing id." }

    const supabase = await createClient()

    if (key === "booking_types") {
      const { data: existing } = await supabase
        .from("rink_booking_types")
        .select("is_system")
        .eq("id", id)
        .eq("facility_id", facility.facilityId)
        .maybeSingle()
      if (existing?.is_system) {
        return {
          ok: false,
          error:
            "Maintenance Block is a built-in type and cannot be deleted. Deactivate it if you do not use it.",
        }
      }
    }

    const { error } = await supabase
      .from(LOOKUP_TABLES[key])
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      if (error.code === "23503") {
        return {
          ok: false,
          error: "In use by existing records. Deactivate it instead.",
        }
      }
      return { ok: false, error: dbError(error, "Failed to delete entry.") }
    }

    revalidatePath(ADMIN_PATH)
    return { ok: true }
  } catch (e) {
    return caughtSimple(e)
  }
}

// ===========================================================================
// RATE CARDS — org_admin tier (ensureModuleAdmin, not ensureFacilityManager)
// ===========================================================================

export async function createRateCard(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const facility = await ensureModuleAdmin()
    if (!facility.ok) return fail(facility.error)

    const name = nonEmpty(formData.get("name"))
    if (!name) return fail("Rate card name is required.")

    const effectiveStart = nonEmpty(formData.get("effective_start"))
    if (!effectiveStart) return fail("An effective start date is required.")

    const effectiveEnd = nonEmpty(formData.get("effective_end"))
    if (effectiveEnd && effectiveEnd < effectiveStart) {
      return fail("The end date cannot fall before the start date.")
    }

    const prime = asMoney(formData.get("hourly_rate_prime"))
    const nonprime = asMoney(formData.get("hourly_rate_nonprime"))
    if (prime === null) return fail("Prime hourly rate must be a number of 0 or more.")
    if (nonprime === null) {
      return fail("Non-prime hourly rate must be a number of 0 or more.")
    }

    const supabase = await createClient()
    const { error } = await supabase.from("rink_rate_cards").insert({
      facility_id: facility.facilityId,
      name,
      effective_start: effectiveStart,
      effective_end: effectiveEnd,
      is_default: formData.get("is_default") === "on",
      hourly_rate_prime: prime,
      hourly_rate_nonprime: nonprime,
    })
    if (error) {
      // 23P01 here can only be the default-card overlap exclusion constraint.
      if (error.code === "23P01") {
        return fail(
          "Another default rate card already covers those dates. Two defaults overlapping would make the rate ambiguous — end the current one first, or add this as a non-default card.",
        )
      }
      return fail(dbError(error, "Failed to create rate card."))
    }

    revalidatePath(ADMIN_PATH)
    return { ok: true, message: "Rate card created." }
  } catch (e) {
    return caught(e)
  }
}

export async function updateRateCard(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const facility = await ensureModuleAdmin()
    if (!facility.ok) return fail(facility.error)

    const id = nonEmpty(formData.get("id"))
    if (!id) return fail("Missing rate card id.")

    const name = nonEmpty(formData.get("name"))
    if (!name) return fail("Rate card name is required.")

    const effectiveStart = nonEmpty(formData.get("effective_start"))
    if (!effectiveStart) return fail("An effective start date is required.")

    const effectiveEnd = nonEmpty(formData.get("effective_end"))
    if (effectiveEnd && effectiveEnd < effectiveStart) {
      return fail("The end date cannot fall before the start date.")
    }

    const prime = asMoney(formData.get("hourly_rate_prime"))
    const nonprime = asMoney(formData.get("hourly_rate_nonprime"))
    if (prime === null || nonprime === null) {
      return fail("Rates must be numbers of 0 or more.")
    }

    const supabase = await createClient()
    const { error } = await supabase
      .from("rink_rate_cards")
      .update({
        name,
        effective_start: effectiveStart,
        effective_end: effectiveEnd,
        is_default: formData.get("is_default") === "on",
        hourly_rate_prime: prime,
        hourly_rate_nonprime: nonprime,
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      if (error.code === "23P01") {
        return fail(
          "Those dates overlap another default rate card. End the current one first, or make this card non-default.",
        )
      }
      return fail(dbError(error, "Failed to update rate card."))
    }

    revalidatePath(ADMIN_PATH)
    return {
      ok: true,
      // Worth saying out loud: admins reasonably fear that editing a card
      // silently restates past invoices.
      message: "Rate card updated. Existing bookings keep the rate they were saved with.",
    }
  } catch (e) {
    return caught(e)
  }
}

export async function deleteRateCard(id: string): Promise<SimpleResult> {
  try {
    const facility = await ensureModuleAdmin()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing rate card id." }

    const supabase = await createClient()
    const { error } = await supabase
      .from("rink_rate_cards")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      if (error.code === "23503") {
        return {
          ok: false,
          error:
            "This card is a customer's default. Point those customers elsewhere first.",
        }
      }
      return { ok: false, error: dbError(error, "Failed to delete rate card.") }
    }

    revalidatePath(ADMIN_PATH)
    return { ok: true }
  } catch (e) {
    return caughtSimple(e)
  }
}

export async function addRateCardWindow(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const facility = await ensureModuleAdmin()
    if (!facility.ok) return fail(facility.error)

    const rateCardId = nonEmpty(formData.get("rate_card_id"))
    if (!rateCardId) return fail("Missing rate card.")

    const day = asInt(formData.get("day_of_week"))
    if (day === null || day < 0 || day > 6) return fail("Pick a day of the week.")

    const start = String(formData.get("start_time") ?? "")
    const end = String(formData.get("end_time") ?? "")
    const startMin = parseTimeToMinutes(start)
    const endMin = parseTimeToMinutes(end)
    if (startMin === null) return fail("Start time must look like 17:00.")
    if (endMin === null) return fail("End time must look like 22:00.")
    if (endMin <= startMin) {
      // A prime window is a slice of one local day; a window that wrapped past
      // midnight would need splitting across two day_of_week rows, so ask the
      // admin to enter it as two windows rather than guessing.
      return fail(
        "The end time must be after the start time. For a window running past midnight, add one window ending at 23:59 and another starting at 00:00 on the next day.",
      )
    }

    const supabase = await createClient()
    const { error } = await supabase.from("rink_rate_card_windows").insert({
      facility_id: facility.facilityId,
      rate_card_id: rateCardId,
      day_of_week: day,
      start_time: start,
      end_time: end,
    })
    if (error) return fail(dbError(error, "Failed to add the prime window."))

    revalidatePath(ADMIN_PATH)
    return { ok: true, message: "Prime window added." }
  } catch (e) {
    return caught(e)
  }
}

export async function deleteRateCardWindow(id: string): Promise<SimpleResult> {
  try {
    const facility = await ensureModuleAdmin()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing window id." }

    const supabase = await createClient()
    const { error } = await supabase
      .from("rink_rate_card_windows")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) return { ok: false, error: dbError(error, "Failed to remove the window.") }

    revalidatePath(ADMIN_PATH)
    return { ok: true }
  } catch (e) {
    return caughtSimple(e)
  }
}

export async function saveRateCardOverride(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const facility = await ensureModuleAdmin()
    if (!facility.ok) return fail(facility.error)

    const rateCardId = nonEmpty(formData.get("rate_card_id"))
    const bookingTypeId = nonEmpty(formData.get("booking_type_id"))
    if (!rateCardId || !bookingTypeId) return fail("Pick a booking type.")

    const prime = asMoney(formData.get("hourly_rate_prime"))
    const nonprime = asMoney(formData.get("hourly_rate_nonprime"))
    if (prime === null || nonprime === null) {
      return fail("Override rates must be numbers of 0 or more. Use 0 for a free or chargeback type.")
    }

    const supabase = await createClient()
    const { error } = await supabase.from("rink_rate_card_type_overrides").upsert(
      {
        facility_id: facility.facilityId,
        rate_card_id: rateCardId,
        booking_type_id: bookingTypeId,
        hourly_rate_prime: prime,
        hourly_rate_nonprime: nonprime,
      },
      { onConflict: "rate_card_id,booking_type_id" },
    )
    if (error) return fail(dbError(error, "Failed to save the override."))

    revalidatePath(ADMIN_PATH)
    return { ok: true, message: "Override saved." }
  } catch (e) {
    return caught(e)
  }
}

export async function deleteRateCardOverride(id: string): Promise<SimpleResult> {
  try {
    const facility = await ensureModuleAdmin()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing override id." }

    const supabase = await createClient()
    const { error } = await supabase
      .from("rink_rate_card_type_overrides")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to remove the override.") }
    }

    revalidatePath(ADMIN_PATH)
    return { ok: true }
  } catch (e) {
    return caughtSimple(e)
  }
}

// ===========================================================================
// DISPLAY TOKENS
// ===========================================================================

/**
 * Creates a display token and returns the plaintext EXACTLY ONCE.
 *
 * Only the sha256 hash is stored, so the URL cannot be recovered later — if an
 * admin loses it, they revoke and issue a new one. That is a deliberate
 * improvement on schedule_ics_tokens (migration 168), which keeps its token in
 * the clear. Lookup stays O(1) because the public endpoint hashes the token it
 * was given and matches on the hash.
 *
 * 32 random bytes, base64url: ~256 bits, well past guessing, and URL-safe so
 * it can be typed into a TV browser.
 */
export async function createDisplayToken(
  label: string,
  hoursAhead: number,
  refreshSeconds: number,
): Promise<{ ok: true; token: CreatedToken } | { ok: false; error: string }> {
  try {
    const facility = await ensureFacilityManager()
    if (!facility.ok) return { ok: false, error: facility.error }

    const trimmed = label.trim()
    if (!trimmed) {
      return { ok: false, error: "Give the display a label, e.g. “Lobby TV”." }
    }
    if (!Number.isInteger(hoursAhead) || hoursAhead < 1 || hoursAhead > 48) {
      return { ok: false, error: "Hours ahead must be between 1 and 48." }
    }
    if (!Number.isInteger(refreshSeconds) || refreshSeconds < 15 || refreshSeconds > 3600) {
      return { ok: false, error: "Refresh must be between 15 and 3600 seconds." }
    }

    const plaintext = randomBytes(32).toString("base64url")
    const tokenHash = createHash("sha256").update(plaintext).digest("hex")

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("rink_display_tokens")
      .insert({
        facility_id: facility.facilityId,
        token_hash: tokenHash,
        label: trimmed,
        display_type: "locker_rooms",
        settings: { hours_ahead: hoursAhead, refresh_seconds: refreshSeconds },
        is_active: true,
      })
      .select("id")
      .maybeSingle()
    if (error || !data) {
      return { ok: false, error: dbError(error, "Failed to create the display token.") }
    }

    revalidatePath(ADMIN_PATH)
    return {
      ok: true,
      token: { id: data.id, label: trimmed, url: `/display/${plaintext}` },
    }
  } catch (e) {
    // Not caughtSimple(): this action's success arm carries the plaintext
    // token, so its type is wider than SimpleResult.
    logServerError("admin/rink-scheduling/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function revokeDisplayToken(id: string): Promise<SimpleResult> {
  try {
    const facility = await ensureFacilityManager()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing token id." }

    const supabase = await createClient()
    const { error } = await supabase
      .from("rink_display_tokens")
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) return { ok: false, error: dbError(error, "Failed to revoke the token.") }

    revalidatePath(ADMIN_PATH)
    return { ok: true }
  } catch (e) {
    return caughtSimple(e)
  }
}

export async function deleteDisplayToken(id: string): Promise<SimpleResult> {
  try {
    const facility = await ensureFacilityManager()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing token id." }

    const supabase = await createClient()
    const { error } = await supabase
      .from("rink_display_tokens")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) return { ok: false, error: dbError(error, "Failed to delete the token.") }

    revalidatePath(ADMIN_PATH)
    return { ok: true }
  } catch (e) {
    return caughtSimple(e)
  }
}

// ===========================================================================
// MODULE SETTINGS — org_admin tier
// ===========================================================================

export async function updateModuleSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const facility = await ensureModuleAdmin()
    if (!facility.ok) return fail(facility.error)

    const input = {
      defaultBufferMinutes: asInt(formData.get("default_buffer_minutes")) ?? 15,
      slotIncrementMinutes: asInt(formData.get("slot_increment_minutes")) ?? 30,
      defaultPaymentTermsDays: asInt(formData.get("default_payment_terms_days")) ?? 30,
      invoicePrefix: String(formData.get("invoice_prefix") ?? "").trim(),
      taxRatePercent: String(formData.get("tax_rate_percent") ?? ""),
      lockerLeadMinutes: asInt(formData.get("locker_lead_minutes")) ?? 45,
      lockerVacateMinutes: asInt(formData.get("locker_vacate_minutes")) ?? 30,
      displayRefreshSeconds: asInt(formData.get("display_refresh_seconds")) ?? 60,
      reminderCadenceDays: asInt(formData.get("reminder_cadence_days")) ?? 7,
    }

    // Validated against the same rules the CHECK constraints enforce, so the
    // admin gets a sentence rather than a constraint name.
    const errors = validateSettings(input)
    const firstError = Object.values(errors)[0]
    if (firstError) return fail(firstError)

    const tax = parseTaxRatePercent(input.taxRatePercent)
    if (tax.error) return fail(tax.error)

    const supabase = await createClient()
    const { error } = await supabase.from("rink_scheduling_settings").upsert(
      {
        facility_id: facility.facilityId,
        default_buffer_minutes: input.defaultBufferMinutes,
        slot_increment_minutes: input.slotIncrementMinutes,
        default_payment_terms_days: input.defaultPaymentTermsDays,
        invoice_prefix: input.invoicePrefix,
        tax_rate: tax.value,
        coverage_check_enabled: formData.get("coverage_check_enabled") === "on",
        locker_lead_minutes: input.lockerLeadMinutes,
        locker_vacate_minutes: input.lockerVacateMinutes,
        display_refresh_seconds: input.displayRefreshSeconds,
        send_booking_confirmations: formData.get("send_booking_confirmations") === "on",
        overdue_reminders_enabled: formData.get("overdue_reminders_enabled") === "on",
        reminder_cadence_days: input.reminderCadenceDays,
      },
      { onConflict: "facility_id" },
    )
    if (error) return fail(dbError(error, "Failed to save settings."))

    await enqueueCoverageRecheck(facility.facilityId, "settings_change")
    revalidatePath(ADMIN_PATH)
    return { ok: true, message: "Settings saved." }
  } catch (e) {
    return caught(e)
  }
}

// ===========================================================================
// SEED DEFAULTS
// ===========================================================================

/**
 * Calls the same idempotent seeder the facilities AFTER INSERT trigger runs, so
 * a facility created before this module shipped can catch up. ON CONFLICT DO
 * NOTHING throughout, so it never clobbers an admin's edits.
 */
export async function seedRinkSchedulingDefaults(): Promise<SimpleResult> {
  try {
    const facility = await ensureFacilityManager()
    if (!facility.ok) return { ok: false, error: facility.error }

    const supabase = await createClient()
    const { error } = await supabase.rpc("seed_default_rink_scheduling_config", {
      p_facility_id: facility.facilityId,
    })
    if (error) return { ok: false, error: dbError(error, "Failed to seed defaults.") }

    revalidatePath(ADMIN_PATH)
    return { ok: true }
  } catch (e) {
    return caughtSimple(e)
  }
}
