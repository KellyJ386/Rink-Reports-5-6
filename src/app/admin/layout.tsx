import { redirect } from "next/navigation"
import type { ReactNode } from "react"

import { Sidebar } from "@/components/admin/sidebar"
import { AdminHeader } from "@/components/admin/header"
import { Toaster } from "@/components/ui/sonner"
import { createClient } from "@/lib/supabase/server"

// TODO: replace with `import { requireAdmin } from "@/lib/auth"` (Agent A).
async function requireAdmin(): Promise<void> {
  return
}

type AdminProfile = {
  email: string | null
  full_name: string | null
}

async function loadProfile(): Promise<AdminProfile> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { email: null, full_name: null }
    return {
      email: user.email ?? null,
      full_name:
        (user.user_metadata?.full_name as string | undefined) ??
        (user.user_metadata?.name as string | undefined) ??
        null,
    }
  } catch {
    // Build-time / missing env: return blanks so the shell still renders.
    return { email: null, full_name: null }
  }
}

export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  await requireAdmin()
  const profile = await loadProfile()

  // If `requireAdmin()` ever signals unauthenticated by returning falsy,
  // keep a safety net here. (Agent A's real impl will throw/redirect.)
  if (process.env.NEXT_PUBLIC_REQUIRE_ADMIN === "redirect" && !profile.email) {
    redirect("/login")
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-h-screen flex-col lg:pl-60">
        <AdminHeader email={profile.email} fullName={profile.full_name} />
        <main className="flex-1">{children}</main>
      </div>
      <Toaster />
    </div>
  )
}
