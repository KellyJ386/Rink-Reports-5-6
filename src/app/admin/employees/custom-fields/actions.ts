"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import type { ActionState } from "../types"

const FIELD_TYPES = ["text", "number", "date", "boolean"] as const
type FieldType = (typeof FIELD_TYPES)[number]
const KEY_RE = /^[a-z][a-z0-9_]{0,62}$/

function nonEmpty(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function parseDefinition(
  formData: FormData,
):
  | {
      ok: true
      value: {
        key: string
        label: string
        field_type: FieldType
        is_required: boolean
        sort_order: number
        is_active: boolean
      }
    }
  | { ok: false; error: string } {
  const key = nonEmpty(formData.get("key"))
  if (!key) return { ok: false, error: "Key is required." }
  if (!KEY_RE.test(key)) {
    return {
      ok: false,
      error:
        "Key must start with a lowercase letter and contain only lowercase letters, digits, and underscores (max 63 chars).",
    }
  }

  const label = nonEmpty(formData.get("label"))
  if (!label) return { ok: false, error: "Label is required." }
  if (label.length > 200) return { ok: false, error: "Label is too long." }

  const fieldTypeRaw = nonEmpty(formData.get("field_type"))
  if (!fieldTypeRaw || !(FIELD_TYPES as readonly string[]).includes(fieldTypeRaw)) {
    return { ok: false, error: "Invalid field type." }
  }

  const sortOrderRaw = nonEmpty(formData.get("sort_order"))
  const sort_order = sortOrderRaw ? Number(sortOrderRaw) : 0
  if (!Number.isFinite(sort_order)) {
    return { ok: false, error: "Sort order must be a number." }
  }

  return {
    ok: true,
    value: {
      key,
      label,
      field_type: fieldTypeRaw as FieldType,
      is_required: formData.get("is_required") === "on",
      sort_order,
      is_active: formData.get("is_active") !== "off",
    },
  }
}

async function resolveFacilityId(
  formData: FormData,
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
  const fromForm = nonEmpty(formData.get("facility_id"))
  if (!fromForm) {
    return { ok: false, error: "Super admin requires explicit facility id." }
  }
  return { ok: true, facilityId: fromForm }
}

export async function createCustomField(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacilityId(formData)
    if (!facility.ok) return { ok: false, error: facility.error }
    const parsed = parseDefinition(formData)
    if (!parsed.ok) return { ok: false, error: parsed.error }

    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const { error } = await sb.from("employee_custom_fields").insert({
      facility_id: facility.facilityId,
      ...parsed.value,
    })
    if (error) {
      if (error.code === "23505") {
        return { ok: false, error: `Key "${parsed.value.key}" is already used.` }
      }
      return { ok: false, error: error.message }
    }
    revalidatePath("/admin/employees/custom-fields")
    revalidatePath("/admin/employees")
    return { ok: true, message: "Field created." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function updateCustomField(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing field id." }
    const facility = await resolveFacilityId(formData)
    if (!facility.ok) return { ok: false, error: facility.error }
    const parsed = parseDefinition(formData)
    if (!parsed.ok) return { ok: false, error: parsed.error }

    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const { error } = await sb
      .from("employee_custom_fields")
      .update(parsed.value)
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      if (error.code === "23505") {
        return { ok: false, error: `Key "${parsed.value.key}" is already used.` }
      }
      return { ok: false, error: error.message }
    }
    revalidatePath("/admin/employees/custom-fields")
    revalidatePath("/admin/employees")
    return { ok: true, message: "Field updated." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteCustomField(id: string): Promise<ActionState> {
  try {
    await requireAdmin()
    if (!id) return { ok: false, error: "Missing field id." }
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const { error } = await sb.from("employee_custom_fields").delete().eq("id", id)
    if (error) return { ok: false, error: error.message }
    revalidatePath("/admin/employees/custom-fields")
    revalidatePath("/admin/employees")
    return { ok: true, message: "Field deleted." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}
