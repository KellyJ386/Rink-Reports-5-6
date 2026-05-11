"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  ClipboardList,
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
}

const MODULE_NAV: NavItem[] = [
  { label: "Daily Reports",    href: "/reports/daily",         icon: ClipboardList },
  { label: "Ice Depth",        href: "/reports/ice-depth",     icon: Ruler },
  { label: "Ice Operations",   href: "/reports/ice-operations",icon: Snowflake },
  { label: "Incident Reports", href: "/reports/incidents",     icon: AlertCircle },
  { label: "Accident Reports", href: "/reports/accidents",     icon: AlertTriangle },
  { label: "Refrigeration",    href: "/reports/refrigeration", icon: Thermometer },
  { label: "Air Quality",      href: "/reports/air-quality",   icon: Wind },
  { label: "Scheduling",       href: "/reports/scheduling",    icon: Calendar },
  { label: "Communications",   href: "/reports/communications",icon: Mail },
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

  return (
    <nav aria-label="Main navigation" className="flex flex-col gap-1 px-3 py-4">
      <Link
        href="/dashboard"
        onClick={onNavigate}
        aria-current={isActive("/dashboard", true) ? "page" : undefined}
        className={cn(
          "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive("/dashboard", true)
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}
      >
        <LayoutDashboard className="h-4 w-4 shrink-0" />
        <span>Dashboard</span>
      </Link>

      <div className="mt-4">
        <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
          Modules
        </p>
        <div className="flex flex-col gap-0.5">
          {MODULE_NAV.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </div>

      {isAdmin && (
        <div className="mt-4 border-t border-sidebar-border pt-4">
          <Link
            href="/admin"
            onClick={onNavigate}
            aria-current={isActive("/admin") ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive("/admin")
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            <Settings2 className="h-4 w-4 shrink-0" />
            <span>Admin</span>
          </Link>
        </div>
      )}
    </nav>
  )
}
