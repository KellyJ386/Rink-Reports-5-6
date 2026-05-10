import type { ReactNode } from "react"

import { requireAdmin } from "@/lib/auth"

import { SchedulingNav } from "./_components/scheduling-nav"

export const dynamic = "force-dynamic"

export default async function SchedulingAdminLayout({
  children,
}: {
  children: ReactNode
}) {
  await requireAdmin()

  return (
    <div className="flex flex-col">
      <SchedulingNav />
      {children}
    </div>
  )
}
