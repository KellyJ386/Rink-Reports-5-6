import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive text-white",
        outline:
          "border-border text-foreground",
        // Pills use the punchier -100/-800 palette per Palette Refresh spec
        // (status banners keep the softer -50 via the *-soft tokens).
        success:
          "border-transparent bg-[var(--green-100)] text-[var(--green-800)] dark:bg-[rgba(157,218,80,0.18)] dark:text-[var(--green-200)]",
        warning:
          "border-transparent bg-[var(--amber-100)] text-[var(--amber-600)] dark:bg-[rgba(255,201,64,0.18)] dark:text-[var(--amber-200)]",
        error:
          "border-transparent bg-[var(--crimson-100)] text-[var(--crimson-600)] dark:bg-[rgba(255,90,110,0.18)] dark:text-[var(--crimson-200)]",
        info:
          "border-transparent bg-[var(--sky-100)] text-[var(--sky-700)] dark:bg-[rgba(94,190,240,0.18)] dark:text-[var(--sky-200)]",
        special:
          "border-transparent bg-[var(--violet-100)] text-[var(--violet-600)] dark:bg-[rgba(154,130,255,0.18)] dark:text-[var(--violet-200)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
