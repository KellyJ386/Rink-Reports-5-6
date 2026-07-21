import type { ReactNode } from "react"

import { requireAdmin, requireModuleAdmin } from "@/lib/auth"

import { SchedulingNav } from "./_components/scheduling-nav"

export const dynamic = "force-dynamic"

export default async function SchedulingAdminLayout({
  children,
}: {
  children: ReactNode
}) {
  await requireAdmin()
  // Console access alone is not enough: the scheduling RLS write policies
  // gate on the module-scoped scheduling/admin grant. Denying here (with a
  // real /forbidden page) beats rendering a console whose every write fails.
  await requireModuleAdmin("scheduling")

  return (
    <div className="flex flex-col">
      <SchedulingNav />
      {children}
    </div>
  )
}
