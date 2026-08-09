"use server"

// Server actions for Daily Reports form-builder instances (migration 235):
// staff create / save / submit titled report instances against an admin-built
// form. Thin wrappers around the server-only pipeline in `_lib/instances.ts`
// — the pipeline owns validation and the explicit end-of-day lock checks, and
// RLS + the DB lock trigger backstop everything here.
//
// SECURITY: facility_id (and employee_id) are resolved from the session's
// employee row. The input shapes deliberately have no facility field, and
// only the named properties are ever read — a crafted payload carrying
// facility_id is ignored.

import { revalidatePath } from "next/cache"

import { requireUser } from "@/lib/auth"
import { logServerError } from "@/lib/observability/log-server-error"
import { createClient } from "@/lib/supabase/server"

import { createInstance, saveInstance, submitInstance } from "./_lib/instances"

export type InstanceActionResult =
  | { ok: true; instanceId: string; reportDate: string }
  | { ok: false; error: string }

type Caller =
  | { ok: true; employeeId: string; facilityId: string }
  | { ok: false; error: string }

/** Resolve the acting employee + facility from the SESSION, never the client. */
async function resolveCaller(): Promise<Caller> {
  const current = await requireUser()
  const supabase = await createClient()
  const { data: employeeRow, error } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()
  if (error) {
    return { ok: false, error: "Failed to load your account." }
  }
  if (!employeeRow) {
    return {
      ok: false,
      error: "Your account isn't fully set up yet. Contact your administrator.",
    }
  }
  return {
    ok: true,
    employeeId: employeeRow.id,
    facilityId: employeeRow.facility_id,
  }
}

/**
 * "+ Add Report": create a titled instance for TODAY (facility-local; the
 * report date is computed server-side). Freezes the template's fields into
 * the instance's snapshot.
 */
export async function createReportInstance(input: {
  areaId: string
  templateId: string
  title: string
}): Promise<InstanceActionResult> {
  try {
    const caller = await resolveCaller()
    if (!caller.ok) return caller
    if (!input?.areaId || !input?.templateId) {
      return { ok: false, error: "Missing area or template." }
    }
    const supabase = await createClient()
    const result = await createInstance(supabase, {
      employeeId: caller.employeeId,
      facilityId: caller.facilityId,
      areaId: input.areaId,
      templateId: input.templateId,
      title: input.title,
    })
    if (result.ok) revalidatePath("/reports/daily")
    return result
  } catch (e) {
    logServerError("reports/daily/instance-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/**
 * Save a draft's responses (and optionally its title). Partial answers are
 * fine — required fields are only enforced at submit. Rejected with an
 * explicit error when the day is locked.
 */
export async function saveReportInstance(input: {
  instanceId: string
  responses: Record<string, unknown>
  title?: string
}): Promise<InstanceActionResult> {
  try {
    const caller = await resolveCaller()
    if (!caller.ok) return caller
    if (!input?.instanceId) {
      return { ok: false, error: "Missing report id." }
    }
    const supabase = await createClient()
    const result = await saveInstance(supabase, {
      employeeId: caller.employeeId,
      facilityId: caller.facilityId,
      instanceId: input.instanceId,
      responses: input.responses,
      ...(input.title !== undefined ? { title: input.title } : {}),
    })
    if (result.ok) revalidatePath("/reports/daily")
    return result
  } catch (e) {
    logServerError("reports/daily/instance-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/**
 * Submit a draft: full validation against the frozen snapshot (required
 * fields, types, select options), then the one-way draft → submitted
 * transition. Passing `responses` writes them in the same transition;
 * omitting it submits the stored draft as-is.
 */
export async function submitReportInstance(input: {
  instanceId: string
  responses?: Record<string, unknown>
}): Promise<InstanceActionResult> {
  try {
    const caller = await resolveCaller()
    if (!caller.ok) return caller
    if (!input?.instanceId) {
      return { ok: false, error: "Missing report id." }
    }
    const supabase = await createClient()
    const result = await submitInstance(supabase, {
      employeeId: caller.employeeId,
      facilityId: caller.facilityId,
      instanceId: input.instanceId,
      ...(input.responses !== undefined ? { responses: input.responses } : {}),
    })
    if (result.ok) revalidatePath("/reports/daily")
    return result
  } catch (e) {
    logServerError("reports/daily/instance-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}
