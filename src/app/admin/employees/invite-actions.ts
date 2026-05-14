"use server"

import { revalidatePath } from "next/cache"

import { createClient as createServiceClient } from "@supabase/supabase-js"

import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import type { Database } from "@/types/database"

import type { ActionState } from "./types"

function buildServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return null
  }
  return createServiceClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const INVITE_REDIRECT_PATH = "/dashboard"

function inviteRedirectUrl(): string | undefined {
  const site =
    process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!site) return undefined
  try {
    const url = new URL(INVITE_REDIRECT_PATH, site)
    return url.toString()
  } catch {
    return undefined
  }
}

/**
 * Sends a Supabase invite email to an employee. The auth user is created
 * immediately (or fetched if one already exists for that email) and bound
 * onto employees.user_id. The employee_invites row tracks delivery state
 * so admins can see who has a pending invite.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in the server environment.
 */
export async function inviteEmployee(employeeId: string): Promise<ActionState> {
  try {
    const current = await requireAdmin()
    if (!employeeId) return { ok: false, error: "Missing employee id." }

    const supabase = await createClient()

    // Load the target employee in the caller's facility scope (RLS enforces).
    const { data: emp, error: empErr } = await supabase
      .from("employees")
      .select("id, facility_id, email, user_id, is_active")
      .eq("id", employeeId)
      .maybeSingle()

    if (empErr || !emp) {
      return { ok: false, error: "Employee not found." }
    }
    if (!emp.is_active) {
      return { ok: false, error: "Cannot invite an inactive employee." }
    }
    if (!emp.email) {
      return { ok: false, error: "Employee has no email on file." }
    }
    if (emp.user_id) {
      return { ok: false, error: "Employee is already linked to a user." }
    }

    const admin = buildServiceRoleClient()
    if (!admin) {
      return {
        ok: false,
        error:
          "Invites are unavailable: SUPABASE_SERVICE_ROLE_KEY is not configured on the server.",
      }
    }

    const redirectTo = inviteRedirectUrl()
    const { data: inviteData, error: inviteErr } =
      await admin.auth.admin.inviteUserByEmail(emp.email, {
        redirectTo,
        data: { facility_id: emp.facility_id, employee_id: emp.id },
      })

    if (inviteErr || !inviteData?.user) {
      return {
        ok: false,
        error:
          inviteErr?.message?.trim() ||
          "Supabase rejected the invite request.",
      }
    }

    const newUserId = inviteData.user.id

    // Bind the auth user onto the employee row using the privileged client so
    // the employees.user_id update can't be blocked by RLS edge cases.
    const { error: bindErr } = await admin
      .from("employees")
      .update({ user_id: newUserId })
      .eq("id", emp.id)

    if (bindErr) {
      return {
        ok: false,
        error: `Invite sent but failed to bind user: ${bindErr.message}`,
      }
    }

    // Best-effort invite record. Failure here is non-fatal — the invite
    // has already gone out and the user_id binding succeeded.
    // employee_invites is not yet in generated Database types; cast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("employee_invites").insert({
      facility_id: emp.facility_id,
      employee_id: emp.id,
      email: emp.email,
      status: "sent",
      sent_at: new Date().toISOString(),
      invited_by: current.authUser.id,
    })

    revalidatePath("/admin/employees")
    revalidatePath(`/admin/employees/${emp.id}`)
    return { ok: true, message: "Invite sent." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

/**
 * Marks the active invite for an employee as revoked. Does NOT delete the
 * auth.users row — that would orphan submissions, and the admin can always
 * re-invite the same email which will reuse the existing auth user.
 */
export async function revokeEmployeeInvite(
  employeeId: string
): Promise<ActionState> {
  try {
    await requireAdmin()
    if (!employeeId) return { ok: false, error: "Missing employee id." }

    const supabase = await createClient()
    // employee_invites is not yet in generated Database types; cast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("employee_invites")
      .update({ status: "revoked" })
      .eq("employee_id", employeeId)
      .in("status", ["pending", "sent"])

    if (error) return { ok: false, error: error.message }

    revalidatePath("/admin/employees")
    revalidatePath(`/admin/employees/${employeeId}`)
    return { ok: true, message: "Invite revoked." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}
