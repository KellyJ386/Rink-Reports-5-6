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
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard",        href: "/dashboard",              icon: LayoutDashboard, exact: true },
  { label: "Daily Reports",    href: "/reports/daily",          icon: ClipboardList },
  { label: "Ice Depth",        href: "/reports/ice-depth",      icon: Ruler },
  { label: "Ice Operations",   href: "/reports/ice-operations", icon: Snowflake },
  { label: "Refrigeration",    href: "/reports/refrigeration",  icon: Thermometer },
  { label: "Air Quality",      href: "/reports/air-quality",    icon: Wind },
  { label: "Incidents",        href: "/reports/incidents",      icon: AlertCircle },
  { label: "Accidents",        href: "/reports/accidents",      icon: AlertTriangle },
  { label: "Scheduling",       href: "/reports/scheduling",     icon: Calendar },
  { label: "Communications",   href: "/reports/communications", icon: Mail },
  { label: "Facility Paperwork", href: "/reports/facility-paperwork", icon: FolderOpen },
]

interface AppSidebarNavProps {
  isAdmin: boolean
  onNavigate?: () => void
}

export function AppSidebarNav({ isAdmin, onNavigate }: AppSidebarNavProps) {
  const pathname = usePathname()

  const isActive = (href: string, exact = false) => {
    if (exact) return pathname === href
    return pathname === href || pathname.startsWith(href + "/")
  }

  const linkCls = (href: string, exact = false) =>
    cn(
      "flex items-center gap-3 px-4 py-2 text-sm transition-colors duration-150 border-l-[3px]",
      isActive(href, exact)
        ? "border-sidebar-primary bg-sidebar-accent text-sidebar-accent-foreground font-medium"
        : "border-transparent text-sidebar-foreground-muted hover:bg-sidebar-accent/55 hover:text-sidebar-foreground"
    )

  return (
    <nav aria-label="Main navigation" className="flex flex-col py-3">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon
        const active = isActive(item.href, item.exact)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={linkCls(item.href, item.exact)}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{item.label}</span>
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
            <Settings2 className="h-4 w-4 shrink-0" />
            <span>Admin Center</span>
          </Link>
        </>
      )}
    </nav>
  )
}
