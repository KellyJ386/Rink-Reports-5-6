"use server"

import { redirect } from "next/navigation"

import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"

import { buildInputFromFormData, persistAirQuality } from "./_lib/submit"

export type SubmissionFormState = {
  error?: string
}

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

export async function submitAirQualityReport(
  _prev: SubmissionFormState,
  formData: FormData,
): Promise<SubmissionFormState> {
  const input = buildInputFromFormData(formData)
  if (!input) {
    return { error: "Invalid form data." }
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
    return { error: dbError(empErr, "Failed to load your account.") }
  }
  if (!employeeRow) {
    return {
      error: "Your account isn't fully set up yet. Contact your administrator.",
    }
  }

  // Defense-in-depth permission check.
  if (!(await currentUserCan(supabase, "air_quality", "submit"))) {
    return {
      error: "You don't have permission to submit air quality reports.",
    }
  }

  const result = await persistAirQuality(supabase, {
    employeeId: employeeRow.id,
    facilityId: employeeRow.facility_id,
    input,
  })

  if (!result.ok) {
    return { error: result.error }
  }

  redirect(`/reports/air-quality/done?id=${result.reportId}`)
}
