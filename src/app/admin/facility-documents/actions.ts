"use server"

import { randomUUID } from "node:crypto"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  MAX_DOCUMENT_BYTES,
  fileExtension,
  isAllowedDocumentExtension,
  isFacilityDocumentCategory,
  sanitizeFileName,
  titleFromFileName,
} from "@/lib/facility-documents"

import type { ActionState, FacilityDocumentRow, SimpleResult } from "./types"

const BUCKET = "facility-documents"
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type DocsClient = ReturnType<typeof createAdminClient>

function documents(client: DocsClient) {
  // facility_documents isn't in the generated types yet; cast follows the
  // project pattern (see src/app/api/offline-sync/route.ts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client.from("facility_documents" as any)
}

function nonEmpty(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function dbError(
  err: { code?: string; message?: string } | null,
  fallback: string,
): string {
  if (!err) return fallback
  if (err.code === "23505") return "That document conflicts with an existing one."
  return err.message?.trim() || fallback
}

/**
 * Resolve the facility this admin is acting on. Super admins may target any
 * facility via the form's hidden facility_id; everyone else is pinned to their
 * own facility, and a mismatched id is rejected rather than silently coerced.
 */
async function resolveFacility(
  formData: FormData,
): Promise<{ ok: true; facilityId: string } | { ok: false; error: string }> {
  const current = await getCurrentUser()
  const profile = current?.profile
  if (!profile) return { ok: false, error: "Not signed in." }

  const requested = nonEmpty(formData.get("facility_id"))

  if (profile.is_super_admin) {
    if (!requested || !UUID_RE.test(requested)) {
      return { ok: false, error: "Select a facility first." }
    }
    return { ok: true, facilityId: requested }
  }

  if (!profile.facility_id) {
    return { ok: false, error: "No facility assigned to your account." }
  }
  if (requested && requested !== profile.facility_id) {
    return { ok: false, error: "You can only manage your own facility." }
  }
  return { ok: true, facilityId: profile.facility_id }
}

async function resolveUploaderEmployeeId(
  client: DocsClient,
  facilityId: string,
): Promise<string | null> {
  const current = await getCurrentUser()
  const userId = current?.authUser?.id
  if (!userId) return null
  const { data } = await client
    .from("employees")
    .select("id")
    .eq("user_id", userId)
    .eq("facility_id", facilityId)
    .eq("is_active", true)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

function revalidate() {
  revalidatePath("/admin/facility-documents")
  revalidatePath("/reports/facility-paperwork")
}

// ============================================================================
// Bulk upload
// ============================================================================

export async function uploadDocuments(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility(formData)
    if (!facility.ok) return { ok: false, error: facility.error }

    const category = nonEmpty(formData.get("category"))
    if (!category || !isFacilityDocumentCategory(category)) {
      return { ok: false, error: "Choose a valid category." }
    }
    const description = nonEmpty(formData.get("description"))

    const files = formData
      .getAll("files")
      .filter((f): f is File => f instanceof File && f.size > 0)

    if (files.length === 0) {
      return { ok: false, error: "Choose at least one file to upload." }
    }

    const supabase = createAdminClient()
    const uploaderId = await resolveUploaderEmployeeId(
      supabase,
      facility.facilityId,
    )

    const failures: string[] = []
    let uploaded = 0

    for (const file of files) {
      if (!isAllowedDocumentExtension(file.name)) {
        failures.push(
          `${file.name}: unsupported file type (.${fileExtension(file.name) || "?"}).`,
        )
        continue
      }
      if (file.size > MAX_DOCUMENT_BYTES) {
        failures.push(`${file.name}: exceeds the 25 MB limit.`)
        continue
      }

      const docId = randomUUID()
      const storagePath = `${facility.facilityId}/${docId}/${sanitizeFileName(file.name)}`
      const buffer = Buffer.from(await file.arrayBuffer())

      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, buffer, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        })
      if (uploadErr) {
        failures.push(`${file.name}: ${uploadErr.message}`)
        continue
      }

      const { error: insertErr } = await documents(supabase).insert({
        id: docId,
        facility_id: facility.facilityId,
        title: titleFromFileName(file.name),
        description,
        category,
        storage_path: storagePath,
        file_name: file.name.slice(0, 255),
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: uploaderId,
      })
      if (insertErr) {
        // Roll back the orphaned object so a retry can reuse the name.
        await supabase.storage.from(BUCKET).remove([storagePath])
        failures.push(`${file.name}: ${dbError(insertErr, "save failed")}`)
        continue
      }
      uploaded += 1
    }

    revalidate()

    if (uploaded === 0) {
      return {
        ok: false,
        error: failures[0] ?? "No documents were uploaded.",
      }
    }
    const base = `Uploaded ${uploaded} document${uploaded === 1 ? "" : "s"}.`
    return {
      ok: true,
      message:
        failures.length > 0
          ? `${base} ${failures.length} skipped: ${failures.join(" ")}`
          : base,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Edit metadata
// ============================================================================

export async function updateDocument(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility(formData)
    if (!facility.ok) return { ok: false, error: facility.error }

    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing document id." }
    const title = nonEmpty(formData.get("title"))
    if (!title) return { ok: false, error: "Title is required." }
    const category = nonEmpty(formData.get("category"))
    if (!category || !isFacilityDocumentCategory(category)) {
      return { ok: false, error: "Choose a valid category." }
    }
    const description = nonEmpty(formData.get("description"))

    const supabase = createAdminClient()
    const { error } = await documents(supabase)
      .update({
        title: title.slice(0, 200),
        category,
        description,
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update document.") }
    }
    revalidate()
    return { ok: true, message: "Document updated." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function setDocumentActive(
  facilityId: string,
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    const fd = new FormData()
    fd.set("facility_id", facilityId)
    await requireAdmin()
    const facility = await resolveFacility(fd)
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing document id." }

    const supabase = createAdminClient()
    const { error } = await documents(supabase)
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update document.") }
    }
    revalidate()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export async function deleteDocument(
  facilityId: string,
  id: string,
): Promise<SimpleResult> {
  try {
    const fd = new FormData()
    fd.set("facility_id", facilityId)
    await requireAdmin()
    const facility = await resolveFacility(fd)
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing document id." }

    const supabase = createAdminClient()
    const { data: row, error: fetchErr } = await documents(supabase)
      .select("id, storage_path")
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    if (fetchErr) {
      return { ok: false, error: dbError(fetchErr, "Document not found.") }
    }
    const doc = row as Pick<FacilityDocumentRow, "id" | "storage_path"> | null
    if (!doc) return { ok: false, error: "Document not found." }

    const { error: delErr } = await documents(supabase)
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (delErr) {
      return { ok: false, error: dbError(delErr, "Failed to delete document.") }
    }

    // Best-effort: remove the underlying object. The metadata row is already
    // gone, so a failed object delete only leaves an orphaned blob.
    await supabase.storage.from(BUCKET).remove([doc.storage_path])

    revalidate()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}
