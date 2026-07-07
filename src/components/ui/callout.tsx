import * as React from "react"

import { cn } from "@/lib/utils"

type CalloutTone = "warning" | "info" | "success" | "destructive"

const TONE_CLASSES: Record<CalloutTone, string> = {
  warning: "border-warning/40 bg-warning-soft text-warning-soft-foreground",
  info: "border-info/40 bg-info-soft text-info-soft-foreground",
  success: "border-success/40 bg-success-soft text-success-soft-foreground",
  destructive:
    "border-destructive/40 bg-destructive-soft text-destructive-soft-foreground",
}

interface CalloutProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: CalloutTone
  icon?: React.ReactNode
}

/**
 * Inline attention box (offline notices, pending-change warnings, policy
 * hints). One tone system on the `*-soft` status tokens so every callout
 * reads the same in light and dark — don't hand-roll amber/red boxes.
 */
export function Callout({
  tone = "warning",
  icon,
  className,
  children,
  ...props
}: CalloutProps) {
  return (
    <div
      role={tone === "destructive" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    >
      {icon ? (
        <span
          className="mt-0.5 shrink-0 [&_svg]:h-4 [&_svg]:w-4"
          aria-hidden
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
