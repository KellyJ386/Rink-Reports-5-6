"use client"

import * as React from "react"
import Link from "next/link"
import { Menu } from "lucide-react"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AppSidebarNav } from "./sidebar-nav"

interface AppMobileSidebarProps {
  isAdmin: boolean
}

export function AppMobileSidebar({ isAdmin }: AppMobileSidebarProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Open navigation"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground lg:hidden"
      >
        <Menu className="h-4 w-4" />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-72 max-w-full bg-sidebar p-0 text-sidebar-foreground"
      >
        <SheetHeader className="border-b border-sidebar-border px-4 py-3">
          <SheetTitle>
            <Link
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 text-sm font-semibold text-sidebar-foreground"
            >
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground text-xs font-bold">
                RR
              </span>
              <span>Rink Reports</span>
            </Link>
          </SheetTitle>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-3.5rem)]">
          <AppSidebarNav isAdmin={isAdmin} onNavigate={() => setOpen(false)} />
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
