"use client"

import * as React from "react"
import Link from "next/link"
import { LogOut } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { AppMobileSidebar } from "./mobile-sidebar"

interface AppHeaderProps {
  email: string | null
  fullName: string | null
  isAdmin: boolean
}

export function AppHeader({ email, fullName, isAdmin }: AppHeaderProps) {
  const initials = React.useMemo(() => {
    const source = (fullName ?? email ?? "").trim()
    if (!source) return "?"
    const parts = source.split(/\s+/).filter(Boolean)
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
  }, [fullName, email])

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 lg:px-6">
      <div className="lg:hidden">
        <AppMobileSidebar isAdmin={isAdmin} />
      </div>

      <Link
        href="/dashboard"
        className="hidden text-sm font-semibold tracking-tight lg:block"
      >
        Rink Reports
      </Link>

      <div className="ml-auto flex items-center gap-2">
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
