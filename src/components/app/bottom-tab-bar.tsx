"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ClipboardList, Home, Menu, User } from "lucide-react"

import { cn } from "@/lib/utils"
import { AppMobileSidebar } from "./mobile-sidebar"

interface AppBottomTabBarProps {
  isAdmin: boolean
  email: string | null
  fullName: string | null
  /** Enabled module keys for the facility (null = show all). */
  enabledModules?: string[] | null
}

// Staff-only mobile bottom navigation (hidden ≥ lg, where the sidebar takes
// over). Home / Reports / Account are direct links; the Menu tab opens the
// full module sidebar sheet, so it replaces the header hamburger on mobile.
export function AppBottomTabBar({
  isAdmin,
  email,
  fullName,
  enabledModules,
}: AppBottomTabBarProps) {
  const pathname = usePathname()

  const tabCls = (active: boolean) =>
    cn(
      "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-semibold tracking-tight transition-colors",
      active
        ? "text-rr-green"
        : "text-muted-foreground hover:text-foreground",
    )

  const homeActive = pathname === "/dashboard"
  const reportsActive = pathname.startsWith("/reports")
  const accountActive = pathname.startsWith("/account")

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden"
    >
      <Link
        href="/dashboard"
        aria-current={homeActive ? "page" : undefined}
        className={tabCls(homeActive)}
      >
        <Home className="h-5 w-5" aria-hidden />
        Home
      </Link>
      <Link
        href="/reports/daily"
        aria-current={reportsActive ? "page" : undefined}
        className={tabCls(reportsActive)}
      >
        <ClipboardList className="h-5 w-5" aria-hidden />
        Reports
      </Link>
      <AppMobileSidebar
        isAdmin={isAdmin}
        email={email}
        fullName={fullName}
        enabledModules={enabledModules}
        trigger={
          <button type="button" aria-label="Open menu" className={tabCls(false)}>
            <Menu className="h-5 w-5" aria-hidden />
            Menu
          </button>
        }
      />
      <Link
        href="/account"
        aria-current={accountActive ? "page" : undefined}
        className={tabCls(accountActive)}
      >
        <User className="h-5 w-5" aria-hidden />
        Account
      </Link>
    </nav>
  )
}
