"use server"

import { redirect } from "next/navigation"

import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { dispatchRulesForSubmission } from "@/lib/notifications/dispatch"
import { currentUserCan } from "@/lib/permissions/check"

import { isUuid, parseMeasurements, parsePassFail } from "./_lib/compute"
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

  const boardPass = parsePassFail(formData.get("board_pass"))
  const boardFailNotesRaw = String(formData.get("board_fail_notes") ?? "").trim()
  const glassPass = parsePassFail(formData.get("glass_pass"))
  const glassFailNotesRaw = String(formData.get("glass_fail_notes") ?? "").trim()

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
    board_pass: boardPass,
    board_fail_notes: boardPass === false && boardFailNotesRaw.length > 0 ? boardFailNotesRaw : null,
    glass_pass: glassPass,
    glass_fail_notes: glassPass === false && glassFailNotesRaw.length > 0 ? glassFailNotesRaw : null,
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

export type SendResult =
  | { ok: true; count: number }
  | { ok: false; error: string }

/**
 * Sends an already-submitted ice depth session to the send list configured in
 * Admin (Communications routing rules, source_module = "ice_depth"). Invoked
 * from the post-submit "Send" button — ice depth does not auto-send on submit,
 * so distribution stays under the reviewer's control. Returns the number of
 * recipients enqueued.
 */
export async function sendIceDepthReport(sessionId: string): Promise<SendResult> {
  if (!isUuid(sessionId)) {
    return { ok: false, error: "Invalid report." }
  }

  const current = await requireUser()
  const supabase = await createClient()

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
      error: "You don't have permission to send ice depth reports.",
    }
  }

  // Confirm the session exists and belongs to the caller's facility (RLS also
  // enforces this; this gives a clearer error and the slug for the subject).
  const { data: session, error: sessErr } = await supabase
    .from("ice_depth_sessions")
    .select("id, facility_id, layout_id")
    .eq("id", sessionId)
    .maybeSingle()

  if (sessErr) {
    return { ok: false, error: dbError(sessErr, "Failed to load the report.") }
  }
  if (!session || session.facility_id !== employeeRow.facility_id) {
    return { ok: false, error: "Report not found." }
  }

  const { data: layout } = await supabase
    .from("ice_depth_layouts")
    .select("slug")
    .eq("id", session.layout_id)
    .maybeSingle()

  const count = await dispatchRulesForSubmission({
    facilityId: employeeRow.facility_id,
    sourceModule: "ice_depth",
    sourceRecordId: sessionId,
    subject: `Ice depth session submitted${layout?.slug ? ` (${layout.slug})` : ""}`,
  })

  return { ok: true, count }
}
