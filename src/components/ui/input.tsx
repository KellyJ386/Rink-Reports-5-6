import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground bg-card dark:bg-card/60 border border-input flex h-10 w-full min-w-0 rounded-md px-3 py-1 text-base shadow-[var(--shadow-elev-1)] transition-[color,box-shadow,border-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-[var(--accent-brand)] focus-visible:ring-[var(--accent-brand)]/40 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/25 dark:aria-invalid:ring-destructive/45 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
