import type { Metadata } from "next"

import { requireUser } from "@/lib/auth"
import { AccountForm } from "./_components/account-form"
import { loadAccountProfile } from "./_lib/queries"

export const metadata: Metadata = {
  title: "Account settings",
}

export default async function AccountPage() {
  const current = await requireUser()
  const profile = await loadAccountProfile(current.authUser.id)

  if (!profile) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8">
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t load your account. Please try again.
        </p>
      </div>
    )
  }

  // Supabase populates `new_email` while an email change is awaiting
  // verification.
  const pendingEmail =
    (current.authUser as { new_email?: string }).new_email ?? null
  const currentEmail = current.authUser.email ?? profile.email

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1
          className="text-2xl font-semibold tracking-tight"
          style={{ fontFamily: "var(--font-anton), Anton, Impact, sans-serif" }}
        >
          Account settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage your contact details, address, and notification preferences.
        </p>
      </header>

      <AccountForm
        profile={profile}
        currentEmail={currentEmail}
        pendingEmail={pendingEmail}
        isSelf
      />
    </div>
  )
}
