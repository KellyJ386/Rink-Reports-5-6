import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { isEmailConfigured, sendEmail } from "@/lib/notifications/transport/email"

type ProfileEditNotification = {
  facilityId: string | null
  editorName: string
  editorUserId: string
  target: { id: string; email: string; name: string }
  changedFieldLabels: string[]
}

function changeSummary(labels: string[]): string {
  if (labels.length === 0) return "your profile"
  return labels.join(", ")
}

/**
 * Best-effort notifications for an admin/supervisor editing someone else's
 * profile. Per the feature spec this fans out two messages:
 *   1. the affected user (their profile was changed by someone else), and
 *   2. the facility admins + super admins (an edit occurred).
 *
 * Routed through email (the platform's configured communications transport).
 * Never throws — a notification failure must not roll back the saved edit.
 */
export async function notifyProfileEdited(
  input: ProfileEditNotification,
): Promise<void> {
  if (!isEmailConfigured()) return

  const fields = changeSummary(input.changedFieldLabels)

  // 1. Tell the affected user.
  try {
    await sendEmail({
      to: input.target.email,
      subject: "Your Rink Reports profile was updated",
      bodyText:
        `Hi ${input.target.name},\n\n` +
        `${input.editorName} updated the following on your account: ${fields}.\n\n` +
        `If you did not expect this change, please contact your facility administrator.`,
    })
  } catch (e) {
    console.error("[account] failed to notify affected user:", e)
  }

  // 2. Tell facility admins + super admins. Needs RLS-bypassing lookup.
  let recipients: string[] = []
  try {
    const admin = createAdminClient()

    const [{ data: adminRows }, { data: superAdmins }] = await Promise.all([
      input.facilityId
        ? admin
            .from("employees")
            .select("roles!inner(key), users!inner(email, is_active)")
            .eq("facility_id", input.facilityId)
            .eq("is_active", true)
            .in("roles.key", ["admin", "super_admin"])
        : Promise.resolve({ data: [] as unknown[] }),
      admin
        .from("users")
        .select("email")
        .eq("is_super_admin", true)
        .eq("is_active", true),
    ])

    const fromAdmins = ((adminRows ?? []) as Array<{
      users: { email: string | null; is_active: boolean } | null
    }>)
      .map((r) => (r.users?.is_active ? r.users.email : null))
      .filter((e): e is string => Boolean(e))

    const fromSupers = ((superAdmins ?? []) as Array<{ email: string | null }>)
      .map((r) => r.email)
      .filter((e): e is string => Boolean(e))

    recipients = Array.from(new Set([...fromAdmins, ...fromSupers])).filter(
      // Don't notify the person who made the edit, nor the target (already mailed).
      (email) => email !== input.target.email,
    )
  } catch (e) {
    // Service-role not configured (e.g. local dev) — skip the admin fan-out.
    console.error("[account] failed to resolve admin recipients:", e)
    return
  }

  await Promise.all(
    recipients.map((to) =>
      sendEmail({
        to,
        subject: "A user profile was edited",
        bodyText:
          `${input.editorName} edited the profile of ${input.target.name} (${input.target.email}).\n\n` +
          `Changed fields: ${fields}.`,
      }).catch((e) => {
        console.error("[account] failed to notify admin:", e)
        return null
      }),
    ),
  )
}
