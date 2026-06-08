"use server"

import { redirect } from "next/navigation"

import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"

import { isUuid, parseMeasurements } from "./_lib/compute"
import { persistIceDepth } from "./_lib/submit"

export type SubmissionFormState = {
  ok?: false
  error?: string
}

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

type SubmissionResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string }

async function performSubmit(formData: FormData): Promise<SubmissionResult> {
  const current = await requireUser()
  const supabase = await createClient()

  const layoutId = String(formData.get("layout_id") ?? "").trim()
  const layoutSlug = String(formData.get("layout_slug") ?? "").trim()
  const notesRaw = String(formData.get("notes") ?? "").trim()
  const notes = notesRaw.length > 0 ? notesRaw : null

  if (!isUuid(layoutId)) {
    return { ok: false, error: "Invalid layout." }
  }
  if (!layoutSlug) {
    return { ok: false, error: "Invalid layout." }
  }

  const measurements = parseMeasurements(formData.get("measurements_json"))
  if (!measurements) {
    return { ok: false, error: "Invalid measurements payload." }
  }

  const input = {
    layout_id: layoutId,
    layout_slug: layoutSlug,
    notes,
    measurements,
  }

  const { data: employeeRow, error: empErr } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  if (empErr) {
    return { ok: false, error: dbError(empErr, "Failed to load your account.") }
  }
  if (!employeeRow) {
    return {
      ok: false,
      error: "Your account isn't fully set up yet. Contact your administrator.",
    }
  }

  if (!(await currentUserCan(supabase, "ice_depth", "submit"))) {
    return {
      ok: false,
      error: "You don't have permission to submit ice depth reports.",
    }
  }

  const result = await persistIceDepth(supabase, {
    employeeId: employeeRow.id,
    facilityId: employeeRow.facility_id,
    input,
  })

  if (!result.ok) {
    return { ok: false, error: result.error }
  }

  return {
    ok: true,
    redirectTo: `/reports/ice-depth/${encodeURIComponent(
      input.layout_slug
    )}/done?id=${result.reportId}`,
  }
}

export async function submitIceDepthSession(
  _prev: SubmissionFormState,
  formData: FormData
): Promise<SubmissionFormState> {
  const result = await performSubmit(formData)
  if (!result.ok) {
    return { ok: false, error: result.error }
  }
  redirect(result.redirectTo)
}
