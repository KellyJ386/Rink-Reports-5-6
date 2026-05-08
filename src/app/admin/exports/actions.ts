"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import type { ActionState } from "./types"

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
  const current = await getCurrentUser()
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

  const logoUrl = nonEmpty(formData.get("logo_url"))
  if (logoUrl) {
    try {
      new URL(logoUrl)
    } catch {
      return { ok: false, error: "Logo URL must be a valid URL." }
    }
  }

  const payload = {
    facility_id: facilityId,
    logo_url: logoUrl,
    header_text: nonEmpty(formData.get("header_text")),
    footer_text: nonEmpty(formData.get("footer_text")),
    paper_size: paperSize as "letter" | "a4",
    include_facility_name: formData.get("include_facility_name") === "on",
    include_date: formData.get("include_date") === "on",
    include_submitted_by: formData.get("include_submitted_by") === "on",
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("export_settings")
    .upsert(payload, { onConflict: "facility_id" })

  if (error) return { ok: false, error: dbError(error, "Failed to save export settings.") }

  revalidatePath("/admin/exports")
  return { ok: true, message: "Export settings saved." }
}
