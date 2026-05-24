import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border border-input placeholder:text-foreground-subtle bg-input-bg flex min-h-[88px] w-full rounded-md px-3 py-2 text-base shadow-[var(--shadow-elev-1)] transition-[color,box-shadow,border-color] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-[var(--ring)] focus-visible:ring-[var(--ring)]/25 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/25 dark:aria-invalid:ring-destructive/45 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
