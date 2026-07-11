"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  ClipboardList,
  FolderOpen,
  LayoutDashboard,
  Mail,
  Ruler,
  Settings2,
  Snowflake,
  Thermometer,
  Wind,
} from "lucide-react"

import { cn } from "@/lib/utils"

interface NavItem {
  label: string
  href: string
  icon: typeof LayoutDashboard
  exact?: boolean
  // The facility_modules key this entry maps to. Undefined = always shown
  // (Dashboard). When set, the item is hidden if the facility has the module
  // disabled.
  moduleKey?: string
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard",        href: "/dashboard",              icon: LayoutDashboard, exact: true },
  { label: "Daily Reports",    href: "/reports/daily",          icon: ClipboardList, moduleKey: "daily_reports" },
  { label: "Ice Depth",        href: "/reports/ice-depth",      icon: Ruler, moduleKey: "ice_depth" },
  { label: "Ice Operations",   href: "/reports/ice-operations", icon: Snowflake, moduleKey: "ice_operations" },
  { label: "Refrigeration",    href: "/reports/refrigeration",  icon: Thermometer, moduleKey: "refrigeration" },
  { label: "Air Quality",      href: "/reports/air-quality",    icon: Wind, moduleKey: "air_quality" },
  { label: "Incidents",        href: "/reports/incidents",      icon: AlertCircle, moduleKey: "incident_reports" },
  { label: "Accidents",        href: "/reports/accidents",      icon: AlertTriangle, moduleKey: "accident_reports" },
  { label: "Scheduling",       href: "/reports/scheduling",     icon: Calendar, moduleKey: "scheduling" },
  { label: "Communications",   href: "/reports/communications", icon: Mail, moduleKey: "communications" },
  { label: "Facility Paperwork", href: "/reports/facility-paperwork", icon: FolderOpen, moduleKey: "facility_paperwork" },
]

// First enabled staff *reports* route, for entry points that need a single
// "Reports" destination (e.g. the mobile bottom tab) rather than the full nav.
// Falls back to /reports/daily when nothing matches (fail-open, mirrors the
// nav filtering above).
export function firstEnabledReportsHref(
  enabledModules?: string[] | null,
): string {
  const match = NAV_ITEMS.find(
    (item) =>
      item.moduleKey != null &&
      item.href.startsWith("/reports/") &&
      (enabledModules == null || enabledModules.includes(item.moduleKey)),
  )
  return match?.href ?? "/reports/daily"
}

interface AppSidebarNavProps {
  isAdmin: boolean
  // Enabled module keys for the facility, or null to show all (fail-open).
  enabledModules?: string[] | null
  // Optional badge counts keyed by moduleKey (e.g. { communications: 3 }).
  // Computed server-side at render time; absent/0 = no badge.
  badgeCounts?: Record<string, number>
  onNavigate?: () => void
}

export function AppSidebarNav({
  isAdmin,
  enabledModules,
  badgeCounts,
  onNavigate,
}: AppSidebarNavProps) {
  const pathname = usePathname()

  const visibleItems = NAV_ITEMS.filter(
    (item) =>
      !item.moduleKey ||
      enabledModules == null ||
      enabledModules.includes(item.moduleKey),
  )

  const isActive = (href: string, exact = false) => {
    if (exact) return pathname === href
    return pathname === href || pathname.startsWith(href + "/")
  }

  const linkCls = (href: string, exact = false) =>
    cn(
      "flex min-h-11 items-center gap-3 px-4 py-2.5 text-sm transition-colors duration-150 border-l-[3px]",
      isActive(href, exact)
        ? "border-sidebar-primary bg-sidebar-accent text-sidebar-accent-foreground font-medium"
        : "border-transparent text-sidebar-foreground-muted hover:bg-sidebar-accent/55 hover:text-sidebar-foreground"
    )

  return (
    <nav aria-label="Main navigation" className="flex flex-col py-3">
      {visibleItems.map((item) => {
        const Icon = item.icon
        const active = isActive(item.href, item.exact)
        const badge = item.moduleKey ? (badgeCounts?.[item.moduleKey] ?? 0) : 0
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={linkCls(item.href, item.exact)}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{item.label}</span>
            {badge > 0 ? (
              <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-sidebar-primary px-1.5 py-0.5 text-xs font-semibold text-sidebar-primary-foreground">
                {badge > 99 ? "99+" : badge}
                <span className="sr-only"> unread</span>
              </span>
            ) : null}
          </Link>
        )
      })}

      {isAdmin && (
        <>
          <div className="mx-4 my-2 border-t border-sidebar-border" />
          <Link
            href="/admin"
            onClick={onNavigate}
            aria-current={isActive("/admin") ? "page" : undefined}
            className={linkCls("/admin")}
          >
            <Settings2 className="h-4 w-4 shrink-0" aria-hidden />
            <span>Admin Center</span>
          </Link>
        </>
      )}
    </nav>
  )
}
