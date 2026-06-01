"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { LogOut, UserCog } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SyncStatusBadge } from "@/components/offline/sync-status-badge"
import { AppMobileSidebar } from "./mobile-sidebar"
import { ThemeToggle } from "./theme-toggle"

interface AppHeaderProps {
  email: string | null
  fullName: string | null
  isAdmin: boolean
}

export function AppHeader({ email, fullName, isAdmin }: AppHeaderProps) {
  const router = useRouter()
  const initials = React.useMemo(() => {
    const source = (fullName ?? email ?? "").trim()
    if (!source) return "?"
    const parts = source.split(/\s+/).filter(Boolean)
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
  }, [fullName, email])

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/60 bg-background/85 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-background/75 lg:px-6">
      <div className="lg:hidden">
        <AppMobileSidebar isAdmin={isAdmin} email={email} fullName={fullName} />
      </div>

      <Link
        href="/dashboard"
        className="hidden text-sm font-semibold tracking-tight lg:block"
        style={{ fontFamily: "var(--font-anton), Anton, Impact, sans-serif" }}
      >
        Rink Reports
      </Link>

      <div className="ml-auto flex items-center gap-3">
        <SyncStatusBadge />
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Open user menu"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-2 text-sm shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
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
            <DropdownMenuItem onClick={() => router.push("/account")}>
              <UserCog className="h-4 w-4" aria-hidden />
              <span>My Account</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <form action="/logout" method="post">
              <DropdownMenuItem type="submit" className="w-full">
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
