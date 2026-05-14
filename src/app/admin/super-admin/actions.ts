"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { getCurrentUser } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

import type { ActionState } from "./types"

async function requireSuperAdmin() {
  const current = await getCurrentUser()
  if (!current || !current.profile?.is_super_admin) {
    redirect("/forbidden")
  }
  return current
}

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function setSuperAdminFlag(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const current = await requireSuperAdmin()

  const userId = formData.get("user_id")
  const value = formData.get("value") === "true"

  if (typeof userId !== "string" || !userId.trim()) {
    return { ok: false, error: "User ID is required." }
  }
  if (!UUID_RE.test(userId.trim())) {
    return { ok: false, error: "Invalid user ID format." }
  }

  if (!value && current.profile?.id === userId.trim()) {
    return { ok: false, error: "You cannot revoke your own super-admin access." }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("users")
    .update({ is_super_admin: value })
    .eq("id", userId)

  if (error)
    return { ok: false, error: dbError(error, "Failed to update super-admin status.") }

  revalidatePath("/admin/super-admin")
  return {
    ok: true,
    message: value ? "User promoted to super admin." : "Super admin access revoked.",
  }
}

export async function sendPasswordReset(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSuperAdmin()

  const email = formData.get("email")
  if (typeof email !== "string" || !email.trim()) {
    return { ok: false, error: "Email is required." }
  }

  // Use the service-role admin client. The user-scoped server client forwards
  // the caller's Supabase session as a Bearer token; if that session is
  // missing or expired GoTrue rejects the call with "This endpoint requires
  // a valid Bearer token". The caller is already verified as a super admin
  // above, so generating the recovery link via the admin API is safe and
  // avoids that failure mode.
  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Service role not configured.",
    }
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? ""
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: email.trim(),
    options: { redirectTo: `${siteUrl}/update-password` },
  })

  if (error) {
    return { ok: false, error: dbError(error, "Failed to create password reset link.") }
  }

  const actionLink = data?.properties?.action_link ?? null
  return {
    ok: true,
    message: actionLink
      ? `Password reset link created. Share this one-time link with the user: ${actionLink}`
      : "Password reset email sent.",
  }
}

export async function setFacilityActive(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSuperAdmin()

  const facilityId = formData.get("facility_id")
  const value = formData.get("value") === "true"

  if (typeof facilityId !== "string" || !facilityId.trim()) {
    return { ok: false, error: "Facility ID is required." }
  }
  if (!UUID_RE.test(facilityId.trim())) {
    return { ok: false, error: "Invalid facility ID format." }
  }

  const supabase = await createClient()

  const { count } = await supabase
    .from("facilities")
    .select("id", { count: "exact", head: true })
    .eq("id", facilityId.trim())
  if (!count) return { ok: false, error: "Facility not found." }

  const { error } = await supabase
    .from("facilities")
    .update({ is_active: value })
    .eq("id", facilityId)

  if (error)
    return { ok: false, error: dbError(error, "Failed to update facility status.") }

  revalidatePath("/admin/super-admin")
  return {
    ok: true,
    message: value ? "Facility activated." : "Facility deactivated.",
  }
}
