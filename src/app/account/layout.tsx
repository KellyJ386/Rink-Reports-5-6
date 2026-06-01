import type { ReactNode } from "react"

import { AppSidebar } from "@/components/app/sidebar"
import { AppHeader } from "@/components/app/header"
import { Toaster } from "@/components/ui/sonner"
import { getIsAdmin, requireUser } from "@/lib/auth"

export default async function AccountLayout({
  children,
}: {
  children: ReactNode
}) {
  const current = await requireUser()
  const profile = current.profile
  const email = profile?.email ?? current.authUser.email ?? null
  const fullName = profile?.full_name ?? null
  const isAdmin = await getIsAdmin(current)

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar isAdmin={isAdmin} email={email} fullName={fullName} />
      <div className="flex min-h-screen flex-col lg:pl-64 xl:pl-72">
        <AppHeader email={email} fullName={fullName} isAdmin={isAdmin} />
        <main
          id="main-content"
          className="flex-1 2xl:mx-auto 2xl:w-full 2xl:max-w-screen-2xl"
        >
          {children}
        </main>
      </div>
      <Toaster />
    </div>
  )
}
