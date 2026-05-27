"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import type { ImportResult, ValidatedRow } from "@/components/admin/bulk-upload"

import { checklistImportSpec } from "./_components/checklist-import"
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

function isAreaCapError(err: SupabaseError): boolean {
  if (!err) return false
  // Migration uses raise_exception; PG returns code P0001 with our friendly
  // message. Match on either the code or the message text.
  if (err.code === "P0001") return true
  return /30 active|maximum.*30|active areas/i.test(err.message ?? "")
}

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  if (isAreaCapError(err)) return "Maximum 30 active areas reached."
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
// Areas
// ============================================================================

export async function createArea(
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
          "Slug must be lowercase letters, digits, and hyphens (e.g. ice-resurfacer-room).",
      }
    }

    const color = nonEmpty(formData.get("color"))
    const sort_order = asInt(formData.get("sort_order")) ?? 0

    const supabase = await createClient()
    const { error } = await supabase.from("daily_report_areas").insert({
      facility_id: facility.facilityId,
      name,
      slug,
      color,
      sort_order,
    })

    if (error) return { ok: false, error: dbError(error, "Failed to create area.") }
    revalidatePath("/admin/daily-reports")
    return { ok: true, message: "Area created." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function updateArea(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing area id." }

    const name = nonEmpty(formData.get("name"))
    if (!name) return { ok: false, error: "Name is required." }

    const rawSlug = nonEmpty(formData.get("slug"))
    const slug = rawSlug ?? slugify(name)
    if (!SLUG_RE.test(slug)) {
      return {
        ok: false,
        error:
          "Slug must be lowercase letters, digits, and hyphens (e.g. ice-resurfacer-room).",
      }
    }

    const color = nonEmpty(formData.get("color"))
    const sort_order = asInt(formData.get("sort_order"))
    const is_active = formData.get("is_active") === "on"

    const supabase = await createClient()
    const { error } = await supabase
      .from("daily_report_areas")
      .update({
        name,
        slug,
        color,
        ...(sort_order !== null ? { sort_order } : {}),
        is_active,
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)

    if (error) return { ok: false, error: dbError(error, "Failed to update area.") }
    revalidatePath("/admin/daily-reports")
    return { ok: true, message: "Area updated." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function setAreaActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing area id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("daily_report_areas")
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) return { ok: false, error: dbError(error, "Failed to update area.") }
    revalidatePath("/admin/daily-reports")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function reorderArea(
  id: string,
  sort_order: number,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing area id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("daily_report_areas")
      .update({ sort_order })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) return { ok: false, error: dbError(error, "Failed to reorder area.") }
    revalidatePath("/admin/daily-reports")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteArea(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing area id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("daily_report_areas")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      // FK restrict from submissions: friendly error per spec.
      if (error.code === "23503") {
        return {
          ok: false,
          error:
            "Cannot delete area with existing submissions; deactivate instead.",
        }
      }
      return { ok: false, error: dbError(error, "Failed to delete area.") }
    }
    revalidatePath("/admin/daily-reports")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Templates
// ============================================================================

export async function createTemplate(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const area_id = nonEmpty(formData.get("area_id"))
    if (!area_id) return { ok: false, error: "Area is required." }
    const name = nonEmpty(formData.get("name"))
    if (!name) return { ok: false, error: "Name is required." }
    const description = nonEmpty(formData.get("description"))
    const sort_order = asInt(formData.get("sort_order")) ?? 0

    const supabase = await createClient()
    const { error } = await supabase.from("daily_report_templates").insert({
      facility_id: facility.facilityId,
      area_id,
      name,
      description,
      sort_order,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to create template.") }
    }
    revalidatePath("/admin/daily-reports")
    return { ok: true, message: "Template created." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function updateTemplate(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing template id." }
    const name = nonEmpty(formData.get("name"))
    if (!name) return { ok: false, error: "Name is required." }
    const description = nonEmpty(formData.get("description"))
    const sort_order = asInt(formData.get("sort_order"))
    const is_active = formData.get("is_active") === "on"

    const supabase = await createClient()
    const { error } = await supabase
      .from("daily_report_templates")
      .update({
        name,
        description,
        ...(sort_order !== null ? { sort_order } : {}),
        is_active,
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update template.") }
    }
    revalidatePath("/admin/daily-reports")
    return { ok: true, message: "Template updated." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function setTemplateActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing template id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("daily_report_templates")
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update template.") }
    }
    revalidatePath("/admin/daily-reports")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteTemplate(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing template id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("daily_report_templates")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      if (error.code === "23503") {
        return {
          ok: false,
          error:
            "Cannot delete template with existing submissions; deactivate instead.",
        }
      }
      return { ok: false, error: dbError(error, "Failed to delete template.") }
    }
    revalidatePath("/admin/daily-reports")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Checklist Items
// ============================================================================

export async function createChecklistItem(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const template_id = nonEmpty(formData.get("template_id"))
    if (!template_id) return { ok: false, error: "Template is required." }
    const label = nonEmpty(formData.get("label"))
    if (!label) return { ok: false, error: "Label is required." }
    const description = nonEmpty(formData.get("description"))

    const supabase = await createClient()

    // Auto-assign sort_order if not provided: max + 1.
    let sort_order = asInt(formData.get("sort_order"))
    if (sort_order === null) {
      const { data: maxRow } = await supabase
        .from("daily_report_checklist_items")
        .select("sort_order")
        .eq("template_id", template_id)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle()
      sort_order = (maxRow?.sort_order ?? -1) + 1
    }

    const { error } = await supabase.from("daily_report_checklist_items").insert({
      facility_id: facility.facilityId,
      template_id,
      label,
      description,
      sort_order,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to create item.") }
    }
    revalidatePath("/admin/daily-reports")
    return { ok: true, message: "Item created." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

type ChecklistImportRow = { label: string; description?: string }

export async function importDailyChecklistItems(
  templateId: string,
  rows: ValidatedRow[],
): Promise<ImportResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!templateId) return { ok: false, error: "Template is required." }
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, error: "No rows to import." }
    }

    // Re-validate every row server-side; never trust the client payload.
    const parsed: ChecklistImportRow[] = []
    for (const r of rows) {
      const res = checklistImportSpec.zodRow.safeParse(r?.values)
      if (!res.success) {
        return {
          ok: false,
          error: `Row ${r?.rowNumber ?? "?"} failed validation.`,
        }
      }
      parsed.push(res.data as ChecklistImportRow)
    }

    const supabase = await createClient()

    // The template must belong to the caller's facility.
    const { data: tmpl } = await supabase
      .from("daily_report_templates")
      .select("id")
      .eq("id", templateId)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    if (!tmpl) return { ok: false, error: "Template not found." }

    const { data: maxRow } = await supabase
      .from("daily_report_checklist_items")
      .select("sort_order")
      .eq("template_id", templateId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle()
    const start = (maxRow?.sort_order ?? -1) + 1

    const insertRows = parsed.map((row, i) => ({
      facility_id: facility.facilityId,
      template_id: templateId,
      label: row.label,
      description: row.description ?? null,
      sort_order: start + i,
    }))

    const { error } = await supabase
      .from("daily_report_checklist_items")
      .insert(insertRows)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to import items.") }
    }
    revalidatePath("/admin/daily-reports")
    return {
      ok: true,
      inserted: insertRows.length,
      message: `Imported ${insertRows.length} item(s).`,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function updateChecklistItem(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing item id." }
    const label = nonEmpty(formData.get("label"))
    if (!label) return { ok: false, error: "Label is required." }
    const description = nonEmpty(formData.get("description"))
    const sort_order = asInt(formData.get("sort_order"))
    const is_active = formData.get("is_active") === "on"

    const supabase = await createClient()
    const { error } = await supabase
      .from("daily_report_checklist_items")
      .update({
        label,
        description,
        ...(sort_order !== null ? { sort_order } : {}),
        is_active,
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update item.") }
    }
    revalidatePath("/admin/daily-reports")
    return { ok: true, message: "Item updated." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteChecklistItem(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing item id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("daily_report_checklist_items")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to delete item.") }
    }
    revalidatePath("/admin/daily-reports")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function reorderChecklistItem(
  id: string,
  sort_order: number,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing item id." }
    const supabase = await createClient()
    const { error } = await supabase
      .from("daily_report_checklist_items")
      .update({ sort_order })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to reorder item.") }
    }
    revalidatePath("/admin/daily-reports")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/**
 * Swap sort_order with the previous/next item in the same template.
 * Direction: -1 moves up, +1 moves down.
 */
export async function moveChecklistItem(
  id: string,
  direction: -1 | 1,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing item id." }
    const supabase = await createClient()

    const { data: cur, error: curErr } = await supabase
      .from("daily_report_checklist_items")
      .select("id, template_id, sort_order")
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    if (curErr || !cur) {
      return { ok: false, error: dbError(curErr, "Item not found.") }
    }

    const neighborQuery = supabase
      .from("daily_report_checklist_items")
      .select("id, sort_order")
      .eq("template_id", cur.template_id)
      .neq("id", cur.id)
    const { data: neighbor, error: nErr } =
      direction < 0
        ? await neighborQuery
            .lt("sort_order", cur.sort_order)
            .order("sort_order", { ascending: false })
            .limit(1)
            .maybeSingle()
        : await neighborQuery
            .gt("sort_order", cur.sort_order)
            .order("sort_order", { ascending: true })
            .limit(1)
            .maybeSingle()

    if (nErr) return { ok: false, error: dbError(nErr, "Failed to reorder.") }
    if (!neighbor) {
      // Already at the edge; nothing to do.
      return { ok: true }
    }

    // Swap. Use a temp value (large negative) to avoid any future unique
    // constraint collisions on (template_id, sort_order). There isn't one
    // today, but this is cheap insurance.
    const tmp = -1 - Math.abs(cur.sort_order) - Math.abs(neighbor.sort_order)
    const { error: e1 } = await supabase
      .from("daily_report_checklist_items")
      .update({ sort_order: tmp })
      .eq("id", cur.id)
      .eq("facility_id", facility.facilityId)
    if (e1) return { ok: false, error: dbError(e1, "Failed to reorder.") }

    const { error: e2 } = await supabase
      .from("daily_report_checklist_items")
      .update({ sort_order: cur.sort_order })
      .eq("id", neighbor.id)
      .eq("facility_id", facility.facilityId)
    if (e2) return { ok: false, error: dbError(e2, "Failed to reorder.") }

    const { error: e3 } = await supabase
      .from("daily_report_checklist_items")
      .update({ sort_order: neighbor.sort_order })
      .eq("id", cur.id)
      .eq("facility_id", facility.facilityId)
    if (e3) return { ok: false, error: dbError(e3, "Failed to reorder.") }

    revalidatePath("/admin/daily-reports")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Submissions / items / notes (admin edit path)
// ============================================================================

export async function toggleSubmissionItem(
  submission_item_id: string,
  is_checked: boolean,
): Promise<SimpleResult> {
  try {
    const current = await requireAdmin()
    if (!submission_item_id) {
      return { ok: false, error: "Missing item id." }
    }
    const supabase = await createClient()
    const callerFacilityId = current.profile?.facility_id ?? null
    const facilityId =
      callerFacilityId ??
      (await (async () => {
        const { data } = await supabase
          .from("daily_report_submission_items")
          .select("facility_id")
          .eq("id", submission_item_id)
          .maybeSingle()
        return data?.facility_id ?? null
      })())
    if (!facilityId) return { ok: false, error: "Could not resolve facility." }
    const { error } = await supabase
      .from("daily_report_submission_items")
      .update({ is_checked })
      .eq("id", submission_item_id)
      .eq("facility_id", facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update item.") }
    }
    revalidatePath("/admin/daily-reports")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function addAdminNote(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const submission_id = nonEmpty(formData.get("submission_id"))
    if (!submission_id) return { ok: false, error: "Missing submission id." }
    const body = nonEmpty(formData.get("body"))
    if (!body) return { ok: false, error: "Note cannot be empty." }

    const current = await getCurrentUser()
    const supabase = await createClient()

    // Find the employee row for this user (if any) at the current facility,
    // so we can attribute the note. Falls back to null when the admin doesn't
    // have a corresponding employee row (rare but possible for super admins).
    let employee_id: string | null = null
    if (current?.profile?.id) {
      const { data: emp } = await supabase
        .from("employees")
        .select("id")
        .eq("user_id", current.profile.id)
        .eq("facility_id", facility.facilityId)
        .maybeSingle()
      employee_id = emp?.id ?? null
    }

    const { error } = await supabase.from("daily_report_notes").insert({
      facility_id: facility.facilityId,
      submission_id,
      employee_id,
      body,
      is_admin_note: true,
    })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to add note.") }
    }
    revalidatePath("/admin/daily-reports")
    return { ok: true, message: "Note added." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function updateNote(
  note_id: string,
  body: string,
): Promise<SimpleResult> {
  try {
    const current = await requireAdmin()
    if (!note_id) return { ok: false, error: "Missing note id." }
    const trimmed = body.trim()
    if (trimmed.length === 0) {
      return { ok: false, error: "Note cannot be empty." }
    }
    const supabase = await createClient()
    const callerFacilityId = current.profile?.facility_id ?? null
    const facilityId =
      callerFacilityId ??
      (await (async () => {
        const { data } = await supabase
          .from("daily_report_notes")
          .select("facility_id")
          .eq("id", note_id)
          .maybeSingle()
        return data?.facility_id ?? null
      })())
    if (!facilityId) return { ok: false, error: "Could not resolve facility." }
    const { error } = await supabase
      .from("daily_report_notes")
      .update({ body: trimmed })
      .eq("id", note_id)
      .eq("facility_id", facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update note.") }
    }
    revalidatePath("/admin/daily-reports")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteNote(note_id: string): Promise<SimpleResult> {
  try {
    const current = await requireAdmin()
    if (!note_id) return { ok: false, error: "Missing note id." }
    const supabase = await createClient()
    const callerFacilityId = current.profile?.facility_id ?? null
    const facilityId =
      callerFacilityId ??
      (await (async () => {
        const { data } = await supabase
          .from("daily_report_notes")
          .select("facility_id")
          .eq("id", note_id)
          .maybeSingle()
        return data?.facility_id ?? null
      })())
    if (!facilityId) return { ok: false, error: "Could not resolve facility." }
    const { error } = await supabase
      .from("daily_report_notes")
      .delete()
      .eq("id", note_id)
      .eq("facility_id", facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to delete note.") }
    }
    revalidatePath("/admin/daily-reports")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteSubmission(id: string): Promise<SimpleResult> {
  try {
    const current = await requireAdmin()
    if (!id) return { ok: false, error: "Missing submission id." }
    const supabase = await createClient()
    const facilityId = current.profile?.facility_id ?? null
    let query = supabase
      .from("daily_report_submissions")
      .delete()
      .eq("id", id)
    if (facilityId) {
      query = query.eq("facility_id", facilityId)
    }
    const { error } = await query
    if (error) {
      return { ok: false, error: dbError(error, "Failed to delete submission.") }
    }
    revalidatePath("/admin/daily-reports")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}
