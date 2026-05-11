import Link from "next/link"

import { ScrollArea } from "@/components/ui/scroll-area"
import { AppSidebarNav } from "./sidebar-nav"

interface AppSidebarProps {
  isAdmin: boolean
}

export function AppSidebar({ isAdmin }: AppSidebarProps) {
  return (
    <aside
      className="hidden lg:flex fixed inset-y-0 left-0 w-60 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
      aria-label="App sidebar"
    >
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border px-4">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-sm font-semibold text-sidebar-foreground"
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground text-xs font-bold">
            RR
          </span>
          <span>Rink Reports</span>
        </Link>
      </div>
      <ScrollArea className="flex-1">
        <AppSidebarNav isAdmin={isAdmin} />
      </ScrollArea>
    </aside>
  )
}
