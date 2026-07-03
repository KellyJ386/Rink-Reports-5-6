"use client"

import * as React from "react"
import { Menu } from "lucide-react"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Wordmark } from "@/components/wordmark"
import { AppSidebarNav } from "./sidebar-nav"

function getInitials(fullName: string | null, email: string | null): string {
  const src = (fullName ?? email ?? "").trim()
  if (!src) return "?"
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

interface AppMobileSidebarProps {
  isAdmin: boolean
  email: string | null
  fullName: string | null
  /**
   * Custom trigger element (rendered via `asChild`). The bottom tab bar passes
   * its "Menu" tab here so it opens the same nav sheet. Defaults to the
   * standalone hamburger button when omitted.
   */
  trigger?: React.ReactNode
  /** Staff variant only: enabled module keys for the facility (null = show all). */
  enabledModules?: string[] | null
  /** Optional badge counts keyed by moduleKey (e.g. { communications: 3 }). */
  badgeCounts?: Record<string, number>
}

export function AppMobileSidebar({
  isAdmin,
  email,
  fullName,
  trigger,
  enabledModules,
  badgeCounts,
}: AppMobileSidebarProps) {
  const [open, setOpen] = React.useState(false)
  const initials = getInitials(fullName, email)
  const displayName = fullName?.trim() || email || "User"

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {trigger ? (
        <SheetTrigger asChild>{trigger}</SheetTrigger>
      ) : (
        <SheetTrigger
          aria-label="Open navigation"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground lg:hidden"
        >
          <Menu className="h-4 w-4" />
        </SheetTrigger>
      )}
      <SheetContent
        side="left"
        className="flex w-72 max-w-full flex-col bg-sidebar p-0 text-sidebar-foreground"
      >
        {/* Logo */}
        <SheetHeader className="border-b border-sidebar-border px-4 py-3">
          <SheetTitle>
            <Wordmark href="/dashboard" onClick={() => setOpen(false)} />
          </SheetTitle>
        </SheetHeader>

        {/* Nav */}
        <ScrollArea className="flex-1">
          <AppSidebarNav
            isAdmin={isAdmin}
            enabledModules={enabledModules}
            badgeCounts={badgeCounts}
            onNavigate={() => setOpen(false)}
          />
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
      </SheetContent>
    </Sheet>
  )
}
