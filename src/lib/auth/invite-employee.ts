import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"

export type InviteEmployeeResult =
  | { ok: true; userId: string; alreadyExisted: boolean }
  | { ok: false; error: string }

/**
 * Invite a newly-created employee to set up their account.
 *
 * Uses Supabase's invite flow: an email is sent containing a one-time link
 * that, when clicked, lands the user on /update-password with a recovery
 * session. They set their own password — we never store or transmit a
 * plaintext password.
 *
 * Also upserts the public.users profile row and links it to the employee
 * record via employees.user_id.
 *
 * Best-effort: errors are returned for the caller to surface as a warning,
 * but employee creation should NOT be rolled back on invite failure — the
 * admin can re-send the invite later.
 */
export async function inviteEmployeeByEmail(params: {
  employeeId: string
  facilityId: string
  email: string
  fullName: string
}): Promise<InviteEmployeeResult> {
  const { employeeId, facilityId, email, fullName } = params

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
  const redirectTo = `${siteUrl}/update-password`

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { full_name: fullName, employee_id: employeeId },
  })

  let userId = data?.user?.id ?? null
  let alreadyExisted = false

  if (error) {
    // Common case: an auth user with this email already exists. Look them up
    // and link to the new employee record without resending an invite.
    const looksLikeDuplicate =
      /already|exists|registered/i.test(error.message ?? "") ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (error as any).status === 422
    if (!looksLikeDuplicate) {
      return { ok: false, error: error.message || "Failed to send invite." }
    }
    alreadyExisted = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminAny = admin as any
    const { data: list, error: listErr } =
      await adminAny.auth.admin.listUsers({ page: 1, perPage: 200 })
    if (listErr) {
      return {
        ok: false,
        error: `User already exists but lookup failed: ${listErr.message}`,
      }
    }
    type AuthUserLite = { id: string; email?: string | null }
    const match = (list?.users ?? []).find(
      (u: AuthUserLite) =>
        (u.email ?? "").toLowerCase() === email.toLowerCase(),
    )
    if (!match) {
      return {
        ok: false,
        error: "User already exists but could not be located.",
      }
    }
    userId = match.id
  }

  if (!userId) {
    return { ok: false, error: "Invite returned no user id." }
  }

  // Upsert the profile row. Service-role bypasses RLS, so we set only the
  // fields we trust here — facility assignment happens via the admin UI.
  const { error: profileErr } = await admin.from("users").upsert(
    {
      id: userId,
      email,
      full_name: fullName,
    },
    { onConflict: "id" },
  )
  if (profileErr) {
    return {
      ok: false,
      error: `Auth user created but profile setup failed: ${profileErr.message}`,
    }
  }

  // Link the auth user to the employee record.
  const { error: linkErr } = await admin
    .from("employees")
    .update({ user_id: userId })
    .eq("id", employeeId)
    .eq("facility_id", facilityId)
  if (linkErr) {
    return {
      ok: false,
      error: `Auth user created but employee link failed: ${linkErr.message}`,
    }
  }

  return { ok: true, userId, alreadyExisted }
}
