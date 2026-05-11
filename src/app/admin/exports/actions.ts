"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import type { ActionState } from "./types"
import { MODULE_COLUMN_OPTIONS } from "./types"

type SupabaseError = { code?: string; message?: string } | null

function nonEmpty(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

async function resolveFacility(): Promise<
  { ok: true; facilityId: string } | { ok: false; error: string }
> {
  const current = await requireAdmin()
  const profile = current?.profile
  if (!profile) return { ok: false, error: "Not signed in." }
  if (!profile.facility_id) return { ok: false, error: "No facility assigned." }
  return { ok: true, facilityId: profile.facility_id }
}

export async function saveExportSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const res = await resolveFacility()
  if (!res.ok) return { ok: false, error: res.error }
  const { facilityId } = res

  const paperSize = nonEmpty(formData.get("paper_size")) ?? "letter"
  if (paperSize !== "letter" && paperSize !== "a4") {
    return { ok: false, error: "Invalid paper size." }
  }

  const dateFormat = nonEmpty(formData.get("date_format")) ?? "MM/DD/YYYY"
  if (!["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"].includes(dateFormat)) {
    return { ok: false, error: "Invalid date format." }
  }

  const csvDelimiter = nonEmpty(formData.get("csv_delimiter")) ?? "comma"
  if (!["comma", "tab", "semicolon"].includes(csvDelimiter)) {
    return { ok: false, error: "Invalid CSV delimiter." }
  }

  const logoUrl = nonEmpty(formData.get("logo_url"))
  if (logoUrl) {
    try {
      new URL(logoUrl)
    } catch {
      return { ok: false, error: "Logo URL must be a valid URL." }
    }
  }

  // Build module_column_visibility from checkboxes: col_{moduleKey}_{colKey}
  const moduleColumnVisibility: Record<string, string[]> = {}
  for (const [moduleKey, cols] of Object.entries(MODULE_COLUMN_OPTIONS)) {
    const visible = cols
      .filter((c) => formData.get(`col_${moduleKey}_${c.key}`) === "on")
      .map((c) => c.key)
    if (visible.length > 0) {
      moduleColumnVisibility[moduleKey] = visible
    }
  }

  const payload = {
    facility_id: facilityId,
    logo_url: logoUrl,
    header_text: nonEmpty(formData.get("header_text")),
    footer_text: nonEmpty(formData.get("footer_text")),
    paper_size: paperSize as "letter" | "a4",
    date_format: dateFormat as "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD",
    csv_delimiter: csvDelimiter as "comma" | "tab" | "semicolon",
    include_facility_name: formData.get("include_facility_name") === "on",
    include_date: formData.get("include_date") === "on",
    include_submitted_by: formData.get("include_submitted_by") === "on",
    module_column_visibility: moduleColumnVisibility,
  }

  const supabase = await createClient()
  // Cast required: generated types predate migrations 36-37 (date_format, csv_delimiter,
  // module_column_visibility). Remove cast once types are regenerated after migration run.
  const { error } = await supabase
    .from("export_settings")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .upsert(payload as any, { onConflict: "facility_id" })

  if (error) return { ok: false, error: dbError(error, "Failed to save export settings.") }

  revalidatePath("/admin/exports")
  return { ok: true, message: "Export settings saved." }
}
