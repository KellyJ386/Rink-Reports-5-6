"use client"

import { usePathname } from "next/navigation"

import { TabNav } from "@/components/ui/tab-nav"

const SCHEDULING_NAV: { label: string; href: string }[] = [
  { label: "Overview", href: "/admin/scheduling" },
  { label: "Shifts", href: "/admin/scheduling/shifts" },
  { label: "Templates", href: "/admin/scheduling/templates" },
  { label: "Publish history", href: "/admin/scheduling/publish" },
  {
    label: "Publish requests",
    href: "/admin/scheduling/publish/requests",
  },
  { label: "Time-Off", href: "/admin/scheduling/time-off" },
  { label: "Availability", href: "/admin/scheduling/availability" },
  { label: "Swaps", href: "/admin/scheduling/swaps" },
  { label: "Compliance", href: "/admin/scheduling/compliance" },
  { label: "Job areas", href: "/admin/scheduling/job-areas" },
  { label: "Settings", href: "/admin/scheduling/settings" },
  { label: "Notifications", href: "/admin/scheduling/notifications" },
]

export function SchedulingNav() {
  const pathname = usePathname()

  // Longest-prefix match so a more specific entry wins over its parent
  // (e.g. /publish/requests beats /publish). TabNav then highlights the
  // resolved href via exact matching.
  const activeHref = (() => {
    let best: string | null = null
    for (const item of SCHEDULING_NAV) {
      if (item.href === "/admin/scheduling") {
        if (pathname === "/admin/scheduling") {
          if (best === null) best = item.href
        }
        continue
      }
      if (pathname === item.href || pathname.startsWith(item.href + "/")) {
        if (best === null || item.href.length > best.length) best = item.href
      }
    }
    return best
  })()

  return (
    <div className="sticky top-0 z-10 border-b border-border bg-background px-4 py-3 md:px-6">
      <TabNav
        ariaLabel="Scheduling sections"
        items={SCHEDULING_NAV}
        activeHref={activeHref ?? undefined}
        matchMode="exact"
      />
    </div>
  )
}
