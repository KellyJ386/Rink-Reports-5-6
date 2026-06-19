import * as React from "react"

import { cn } from "@/lib/utils"

type StatValueProps = React.ComponentProps<"span"> & {
  /**
   * "display" → Anton (big dates / headline numbers).
   * "data"    → JetBrains Mono (readings, times, tabular figures).
   */
  variant?: "display" | "data"
}

/**
 * StatValue — the two numeric type treatments of the design system.
 * Date numbers and big stats use the display face; reading/time values use the
 * monospace face. Never render either in the system sans.
 */
function StatValue({ variant = "display", className, ...props }: StatValueProps) {
  return (
    <span
      data-slot="stat-value"
      data-variant={variant}
      className={cn(
        "leading-none text-foreground-strong",
        variant === "display"
          ? "font-display tracking-[0.01em]"
          : "font-mono tabular-nums",
        className
      )}
      {...props}
    />
  )
}

export { StatValue }
