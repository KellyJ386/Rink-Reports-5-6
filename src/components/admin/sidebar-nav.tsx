"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard } from "lucide-react"

import { cn } from "@/lib/utils"
import { adminNavGroups } from "./nav-config"

interface SidebarNavProps {
  onNavigate?: () => void
}

export function SidebarNav({ onNavigate }: SidebarNavProps) {
  const pathname = usePathname()

  const isActive = (href: string) => {
    if (href === "/admin") return pathname === "/admin"
    return pathname === href || pathname.startsWith(href + "/")
  }

  const linkCls = (href: string) =>
    cn(
      "flex items-center gap-3 px-4 py-2 text-sm transition-colors border-l-[3px]",
      isActive(href)
        ? "border-sidebar-primary bg-sidebar-accent text-sidebar-accent-foreground font-medium"
        : "border-transparent text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
    )

  return (
    <nav aria-label="Admin" className="flex flex-col py-3">
      <Link
        href="/admin"
        prefetch={false}
        onClick={onNavigate}
        className={linkCls("/admin")}
      >
        <LayoutDashboard className="h-4 w-4 shrink-0" />
        <span>Dashboard</span>
      </Link>

      {adminNavGroups.map((group) => (
        <div key={group.label} className="mt-2">
          <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/35">
            {group.label}
          </p>
          {group.items.map((item) => {
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                onClick={onNavigate}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={linkCls(item.href)}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
