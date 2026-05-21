"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { ChevronRight, LogOut, User as UserIcon } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MobileSidebar } from "./mobile-sidebar"
import { findActiveNavItem } from "./nav-config"
import { ThemeToggle } from "@/components/app/theme-toggle"

interface AdminHeaderProps {
  email: string | null
  fullName: string | null
}

export function AdminHeader({ email, fullName }: AdminHeaderProps) {
  const pathname = usePathname() ?? "/admin"
  const active = findActiveNavItem(pathname)
  const isDashboard = pathname === "/admin"
  const sectionLabel = isDashboard ? "Dashboard" : (active?.label ?? "Admin")

  const initials = React.useMemo(() => {
    const source = (fullName ?? email ?? "").trim()
    if (!source) return "?"
    const parts = source.split(/\s+/).filter(Boolean)
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
  }, [fullName, email])

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:px-6">
      <div className="lg:hidden">
        <MobileSidebar email={email} fullName={fullName} />
      </div>

      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-1 text-sm"
      >
        <span className="text-muted-foreground">Admin</span>
        {!isDashboard && (
          <>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span
              aria-current="page"
              className="truncate font-medium text-foreground"
            >
              {sectionLabel}
            </span>
          </>
        )}
        {isDashboard && (
          <>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span
              aria-current="page"
              className="truncate font-medium text-foreground"
            >
              Dashboard
            </span>
          </>
        )}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Open user menu"
            className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-2 text-sm shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {initials}
            </span>
            <span className="hidden max-w-[160px] truncate sm:inline">
              {fullName ?? email ?? "User"}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="truncate font-semibold">
                {fullName ?? "Signed in"}
              </span>
              {email && (
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {email}
                </span>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <form action="/logout" method="post">
              <DropdownMenuItem
                type="submit"
                className="w-full"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                <span>Sign out</span>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

// Re-export icon used elsewhere if needed (kept for tree-shake friendliness).
export { UserIcon }
