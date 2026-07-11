"use client"

import * as React from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// The app theme is class-based (.light/.dark on <html>, persisted to
// localStorage 'rr-theme' by ThemeToggle) and can differ from the OS
// preference, so sonner's theme="system" would desync its internal styling
// (icons, close button, default variants) from the app. Track the class the
// same way ThemeToggle does and feed sonner the live value.
function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb)
  obs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  })
  return () => obs.disconnect()
}
function getSnapshot(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}
function getServerSnapshot(): "light" | "dark" {
  return "dark"
}

function Toaster(props: ToasterProps) {
  const theme = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  )
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
