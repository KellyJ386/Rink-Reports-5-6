import type { ReactNode } from "react"

import { StaffHeader } from "@/components/staff/staff-header"
import { Toaster } from "@/components/ui/sonner"
import { requireUser } from "@/lib/auth"

export default async function ReportsLayout({
  children,
}: {
  children: ReactNode
}) {
  const current = await requireUser()
  const profile = current.profile
  const email = profile?.email ?? current.authUser.email ?? null
  const fullName = profile?.full_name ?? null

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <StaffHeader email={email} fullName={fullName} />
      <main className="flex-1">{children}</main>
      <Toaster />
    </div>
  )
}
