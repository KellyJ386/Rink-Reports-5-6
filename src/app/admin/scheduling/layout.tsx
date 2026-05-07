import Link from "next/link"
import type { ReactNode } from "react"

import { requireAdmin } from "@/lib/auth"

export const dynamic = "force-dynamic"

const SCHEDULING_NAV: { label: string; href: string }[] = [
  { label: "Overview", href: "/admin/scheduling" },
  { label: "Shifts", href: "/admin/scheduling/shifts" },
  { label: "Templates", href: "/admin/scheduling/templates" },
  { label: "Publish", href: "/admin/scheduling/publish" },
  { label: "Time-Off", href: "/admin/scheduling/time-off" },
  { label: "Swaps", href: "/admin/scheduling/swaps" },
  { label: "Compliance", href: "/admin/scheduling/compliance" },
  { label: "Settings", href: "/admin/scheduling/settings" },
  { label: "Notifications", href: "/admin/scheduling/notifications" },
]

export default async function SchedulingAdminLayout({
  children,
}: {
  children: ReactNode
}) {
  await requireAdmin()

  return (
    <div className="flex flex-col">
      <nav className="border-border bg-background sticky top-0 z-10 border-b">
        <div className="flex flex-wrap gap-x-4 gap-y-1 overflow-x-auto px-4 py-3 md:px-6">
          {SCHEDULING_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-muted-foreground hover:text-foreground rounded-md px-2 py-1 text-sm font-medium transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
      {children}
    </div>
  )
}
