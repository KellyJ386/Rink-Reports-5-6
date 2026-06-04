"use server"

import { redirect } from "next/navigation"

import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"

import { buildInputFromForm, persistRefrigeration } from "./_lib/submit"

export type SubmissionFormState = {
  error?: string
}

type SubmissionResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string }

async function performSubmit(formData: FormData): Promise<SubmissionResult> {
  const current = await requireUser()
  const supabase = await createClient()

  const input = buildInputFromForm(formData)
  if (!input) {
    return { ok: false, error: "Invalid form data." }
  }

  const { data: employeeRow, error: empErr } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  if (empErr) {
    return { ok: false, error: empErr.message || "Failed to load your account." }
  }
  if (!employeeRow) {
    return {
      ok: false,
      error: "Your account isn't fully set up yet. Contact your administrator.",
    }
  }

  // Defense-in-depth permission check (RLS is the real gate).
  if (!(await currentUserCan(supabase, "refrigeration", "submit"))) {
    return {
      ok: false,
      error: "You don't have permission to submit refrigeration reports.",
    }
  }

  const result = await persistRefrigeration(supabase, {
    employeeId: employeeRow.id,
    facilityId: employeeRow.facility_id,
    input,
  })
  if (!result.ok) {
    return { ok: false, error: result.error }
  }

  return {
    ok: true,
    redirectTo: `/reports/refrigeration/done?id=${result.reportId}`,
  }
}

export async function submitRefrigerationReport(
  _prev: SubmissionFormState,
  formData: FormData
): Promise<SubmissionFormState> {
  const result = await performSubmit(formData)
  if (!result.ok) {
    return { error: result.error }
  }
  redirect(result.redirectTo)
}
