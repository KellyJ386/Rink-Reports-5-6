"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"

const STORAGE_KEY = "rr-theme"
type Theme = "light" | "dark"

// Read the live theme straight off the <html> classList so the toggle's
// label/icon track the inline pre-paint script in layout.tsx, and any
// other tab that may have changed it.
function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb)
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => obs.disconnect()
}
function getSnapshot(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}
function getServerSnapshot(): Theme {
  return "dark"
}

export function ThemeToggle({ className }: { className?: string }) {
  const theme = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark"
    const root = document.documentElement
    root.classList.toggle("dark", next === "dark")
    root.classList.toggle("light", next === "light")
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore quota / disabled storage
    }
  }

  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
  const Icon = theme === "dark" ? Sun : Moon
  // Lucide icons stroke with currentColor, so this colors the icon's outline.
  // Green moon / amber sun stay legible on the header's white toggle button.
  const iconColor =
    theme === "dark" ? "text-rr-yellow" : "text-rr-green-ink"

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      suppressHydrationWarning
      className={
        "inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
        (className ?? "")
      }
    >
      <Icon
        className={"h-4 w-4 " + iconColor}
        aria-hidden
        suppressHydrationWarning
      />
    </button>
  )
}
