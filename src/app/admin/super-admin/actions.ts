"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { getCurrentUser } from "@/lib/auth"
import {
  checkServiceRoleEnv,
  checkSiteUrlEnv,
  createAdminClient,
  getServiceRoleKeyDebugInfo,
} from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/observability/log-server-error"

import type { ActionState, InviteServiceHealth } from "./types"

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
    logServerError("admin/super-admin/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Service role not configured.",
    }
  }

  const site = checkSiteUrlEnv()
  if (!site.ok) return { ok: false, error: site.error.message }
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: email.trim(),
    options: { redirectTo: `${site.siteUrl}/update-password` },
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

/**
 * Probes Supabase Auth's admin endpoint with the configured service-role key
 * and reports the exact failure mode. Lets super admins distinguish "key is
 * missing", "key is rejected (401)", and "key is for the wrong project (403)"
 * without resorting to curl. Surfaces the same misconfiguration that produces
 * the friendly "Email invitations aren't available" toast on the Invite flow.
 */
export async function checkInviteServiceHealth(): Promise<InviteServiceHealth> {
  await requireSuperAdmin()

  const checkedAt = new Date().toISOString()
  const keyDebug = getServiceRoleKeyDebugInfo(
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  )
  // The key fingerprint (length, prefix kind, whitespace) is a diagnostic aid
  // but it narrows the search space for the secret, so it goes to SERVER LOGS
  // only — never into a detail string returned to the browser, even for super
  // admins. The UI gets an actionable message without the fingerprint.
  const keyFingerprint =
    `raw_len=${keyDebug.rawLength}, normalized_len=${keyDebug.normalizedLength}, ` +
    `quoted=${keyDebug.hadWrappingQuotes}, ` +
    `starts_with=${keyDebug.startsWithSbSecret ? "sb_secret_" : keyDebug.startsWithEyJ ? "eyJ" : "other"}, ` +
    `contains_ws=${keyDebug.hasWhitespace}`

  // Local validation first — catches blank, placeholder, and malformed keys
  // before they hit GoTrue (which would only respond with `no_authorization`
  // and obscure the real cause).
  const envCheck = checkServiceRoleEnv()
  if (!envCheck.ok) {
    console.error(
      `[super-admin/checkInviteServiceHealth] service-role env invalid: ${keyFingerprint}`,
    )
    return {
      ok: false,
      reason: "not_configured",
      detail: `${envCheck.error.message} Add it to the environment (and redeploy on Vercel) before retrying.`,
      checkedAt,
    }
  }
  const { url, serviceKey } = envCheck

  // Lightest possible admin call: list one user. Same auth path that
  // inviteUserByEmail uses, so a 200 here proves the Invite flow can authenticate.
  let response: Response
  try {
    response = await fetch(
      `${url.replace(/\/$/, "")}/auth/v1/admin/users?page=1&per_page=1`,
      {
        method: "GET",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        cache: "no-store",
      },
    )
  } catch (e) {
    logServerError("admin/super-admin/actions", e)
    return {
      ok: false,
      reason: "other",
      detail:
        e instanceof Error
          ? `Network error reaching Supabase Auth: ${e.message}`
          : "Network error reaching Supabase Auth.",
      checkedAt,
    }
  }

  if (response.ok) {
    return { ok: true, checkedAt }
  }

  const body = await response.text().catch(() => "")
  if (response.status === 401) {
    console.error(
      `[super-admin/checkInviteServiceHealth] GoTrue rejected service-role key (401): ${keyFingerprint}`,
    )
    return {
      ok: false,
      reason: "unauthorized",
      status: 401,
      detail:
        "Service-role key invalid (HTTP 401 from GoTrue). The configured SUPABASE_SERVICE_ROLE_KEY was rejected — it's missing, rotated, or padded with whitespace. Copy the current service_role key from the Supabase dashboard (Settings → API) and update the env. (Key fingerprint logged server-side.)",
      checkedAt,
    }
  }
  if (response.status === 403) {
    return {
      ok: false,
      reason: "forbidden",
      status: 403,
      detail:
        "Service-role key not authorized for this project (HTTP 403). Verify the key was issued by the same project as NEXT_PUBLIC_SUPABASE_URL.",
      checkedAt,
    }
  }
  // Log the raw GoTrue body server-side rather than echoing it to the browser.
  console.error(
    `[super-admin/checkInviteServiceHealth] unexpected GoTrue response (HTTP ${response.status}): ${body.slice(0, 500)}`,
  )
  return {
    ok: false,
    reason: "other",
    status: response.status,
    detail: `Unexpected response from Supabase Auth (HTTP ${response.status}). Details logged server-side.`,
    checkedAt,
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
