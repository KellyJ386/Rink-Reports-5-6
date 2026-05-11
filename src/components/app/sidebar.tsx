import Link from "next/link"

import { ScrollArea } from "@/components/ui/scroll-area"
import { AppSidebarNav } from "./sidebar-nav"

function getInitials(fullName: string | null, email: string | null): string {
  const src = (fullName ?? email ?? "").trim()
  if (!src) return "?"
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

interface AppSidebarProps {
  isAdmin: boolean
  email: string | null
  fullName: string | null
}

export function AppSidebar({ isAdmin, email, fullName }: AppSidebarProps) {
  const initials = getInitials(fullName, email)
  const displayName = fullName?.trim() || email || "User"

  return (
    <aside
      className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
      aria-label="App sidebar"
    >
      {/* Logo */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-sidebar-border px-4">
        <Link href="/dashboard" className="flex items-center gap-3">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground text-sm font-black">
            R
          </span>
          <span
            className="text-sm font-black uppercase tracking-widest text-sidebar-foreground"
            style={{ fontFamily: "var(--font-anton), Anton, Impact, sans-serif" }}
          >
            Rink Reports
          </span>
        </Link>
      </div>

      {/* Nav */}
      <ScrollArea className="flex-1">
        <AppSidebarNav isAdmin={isAdmin} />
      </ScrollArea>

      {/* User card */}
      <div className="shrink-0 border-t border-sidebar-border p-3">
        <div className="flex items-center gap-2.5 rounded-md px-2 py-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-sidebar-foreground leading-tight">
              {displayName}
            </p>
            {fullName && email && (
              <p className="truncate text-xs text-sidebar-foreground/45 leading-tight">
                {email}
              </p>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
