import * as React from "react"
import Link from "next/link"

import { cn } from "@/lib/utils"

export type TabNavItem = {
  label: React.ReactNode
  href: string
  /** Match this item against `activeHref` by prefix instead of exact equality. */
  matchPrefix?: boolean
}

interface TabNavProps extends Omit<React.HTMLAttributes<HTMLElement>, "children"> {
  items: TabNavItem[]
  activeHref?: string
  /** Default matching strategy when an item doesn't set its own. */
  matchMode?: "exact" | "prefix"
  ariaLabel?: string
}

function isActive(
  item: TabNavItem,
  activeHref: string | undefined,
  matchMode: "exact" | "prefix",
): boolean {
  if (!activeHref) return false
  const mode = item.matchPrefix ? "prefix" : matchMode
  if (mode === "prefix") {
    return (
      activeHref === item.href ||
      activeHref.startsWith(item.href.endsWith("/") ? item.href : item.href + "/")
    )
  }
  return activeHref === item.href
}

/**
 * URL-driven (Link-based) tab bar shared across admin + staff modules.
 * Use the in-page Radix `<Tabs>` primitive (`tabs.tsx`) only when tabs
 * don't change the route.
 */
export function TabNav({
  items,
  activeHref,
  matchMode = "exact",
  ariaLabel,
  className,
  ...props
}: TabNavProps) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        "flex flex-wrap items-center gap-1 rounded-md border border-border bg-card p-1",
        className,
      )}
      {...props}
    >
      {items.map((item, i) => {
        const active = isActive(item, activeHref, matchMode)
        return (
          <Link
            key={`${item.href}-${i}`}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
