import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Eyebrow — small uppercase label that sits above a heading.
 * 10px · 800wt · .14em tracking · UPPERCASE · rr.greyDark (theme-aware via
 * --muted-foreground, which maps to rr.greyDark in light and lifts in dark).
 */
function Eyebrow({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="eyebrow"
      className={cn(
        "text-[10px] font-extrabold uppercase leading-none tracking-[0.14em] text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Eyebrow }
