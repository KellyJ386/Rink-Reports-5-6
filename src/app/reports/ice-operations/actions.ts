"use server"

import { redirect } from "next/navigation"

import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"

import {
  buildInputFromForm,
  persistIceOperation,
  validateIceOpsInput,
} from "./_lib/submit"
import {
  isOperationType,
  resolveEnabledOperationTypes,
  type OperationType,
} from "./types"

export type SubmissionFormState = {
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

async function performSubmit(
  operationType: OperationType,
  formData: FormData
): Promise<SubmissionResult> {
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
      error:
        "Your account isn't fully set up yet. Contact your administrator.",
    }
  }

  // Defense-in-depth permission check.
  if (!(await currentUserCan(supabase, "ice_operations", "submit"))) {
    return {
      ok: false,
      error:
        "You don't have permission to submit ice operations reports.",
    }
  }

  const facilityId = employeeRow.facility_id

  // Reject submissions for operation types the facility has disabled. Mirrors
  // the page-level redirect ([operationType]/page.tsx) so a directly-invoked
  // action can't write a disabled type. Fail-open (null/empty = all enabled),
  // matching the tab list.
  const { data: opSettings } = await supabase
    .from("ice_operations_settings")
    .select("enabled_operation_types")
    .eq("facility_id", facilityId)
    .maybeSingle()
  const enabledOps = resolveEnabledOperationTypes(
    opSettings?.enabled_operation_types,
  )
  if (!enabledOps.includes(operationType)) {
    return {
      ok: false,
      error: "This operation type isn't enabled for your facility.",
    }
  }

  // Reconstruct the structured input from the posted FormData. A null result
  // means malformed circle-check JSON (the previously-opaque "invalid results"
  // case) — surface it as a clean validation error rather than a raw throw.
  const input = buildInputFromForm(operationType, formData)
  if (!input) {
    return { ok: false, error: "Invalid checklist data." }
  }

  // Online submits don't post occurred_at — the operation is logged as it
  // happens, so the server stamps submit time. (Offline submissions carry the
  // ISO instant they were queued at, which survives a late replay.)
  if (!input.occurred_at) {
    input.occurred_at = new Date().toISOString()
  }

  // Pure per-op validation (rink required, equipment required, occurred_at,
  // failed-item notes). Runs before any write, identical to the offline path.
  const validationError = validateIceOpsInput(input)
  if (validationError) {
    return { ok: false, error: validationError }
  }

  const result = await persistIceOperation(supabase, {
    employeeId: employeeRow.id,
    facilityId,
    input,
  })
  if (!result.ok) {
    return { ok: false, error: result.error }
  }

  return {
    ok: true,
    redirectTo: `/reports/ice-operations/${operationType}/done?id=${result.reportId}`,
  }
}

export async function submitIceOperationsReport(
  operationType: string,
  _prev: SubmissionFormState,
  formData: FormData
): Promise<SubmissionFormState> {
  if (!isOperationType(operationType)) {
    return { error: "Unknown operation type." }
  }
  const result = await performSubmit(operationType, formData)
  if (!result.ok) {
    return { error: result.error }
  }
  redirect(result.redirectTo)
}
