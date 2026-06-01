import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { requireUser } from "@/lib/auth"
import { AccountForm } from "../_components/account-form"
import {
  canEditProfile,
  loadAccountProfile,
  profileDisplayName,
} from "../_lib/queries"

export const metadata: Metadata = {
  title: "Edit profile",
}

export default async function EditProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  const { userId } = await params
  const current = await requireUser()

  // Editing yourself? Use the canonical self route.
  if (userId === current.authUser.id) {
    redirect("/account")
  }

  const allowed = await canEditProfile(userId)
  if (!allowed) {
    redirect("/forbidden")
  }

  const profile = await loadAccountProfile(userId)
  if (!profile) {
    notFound()
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1
          className="text-2xl font-semibold tracking-tight"
          style={{ fontFamily: "var(--font-anton), Anton, Impact, sans-serif" }}
        >
          Edit profile
        </h1>
        <p className="text-sm text-muted-foreground">
          You are editing {profileDisplayName(profile)}&apos;s profile. They and
          your facility administrators will be notified of changes.
        </p>
      </header>

      <AccountForm
        profile={profile}
        currentEmail={profile.email}
        pendingEmail={null}
        isSelf={false}
      />
    </div>
  )
}
