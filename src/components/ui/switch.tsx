"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  id?: string
  disabled?: boolean
  className?: string
  "aria-label"?: string
  "aria-describedby"?: string
}

/**
 * Accessible on/off switch built on a native button with `role="switch"`
 * (no extra Radix dependency). Controlled — pair with a hidden input when
 * submitting inside a server-action form.
 */
function Switch({
  checked,
  onCheckedChange,
  id,
  disabled,
  className,
  ...aria
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors outline-none",
        "focus-visible:ring-[var(--ring)]/40 focus-visible:ring-[3px]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input-bg border-input",
        className,
      )}
      {...aria}
    >
      <span
        className={cn(
          "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-[var(--shadow-elev-1)] transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  )
}

export { Switch }
