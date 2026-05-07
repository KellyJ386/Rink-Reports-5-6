import type { ReactNode } from "react"

import { Sidebar } from "@/components/admin/sidebar"
import { AdminHeader } from "@/components/admin/header"
import { Toaster } from "@/components/ui/sonner"
import { requireAdmin } from "@/lib/auth"

export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  const { authUser, profile } = await requireAdmin()
  const email = authUser.email ?? profile?.email ?? null
  const fullName = profile?.full_name ?? null

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-h-screen flex-col lg:pl-60">
        <AdminHeader email={email} fullName={fullName} />
        <main className="flex-1">{children}</main>
      </div>
      <Toaster />
    </div>
  )
}
