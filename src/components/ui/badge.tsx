import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // RinkReports badge: 10px · 800wt · .08em · UPPERCASE pill.
  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase leading-none tracking-[0.08em] transition-colors",
  {
    variants: {
      variant: {
        // Brief variants
        neutral:
          "bg-muted text-muted-foreground",
        success:
          "bg-success-soft text-success-soft-foreground",
        warning:
          "bg-warning-soft text-warning-soft-foreground",
        error:
          "bg-destructive-soft text-destructive-soft-foreground",
        // Retained for existing call sites
        default:
          "bg-primary text-primary-foreground",
        secondary:
          "bg-secondary text-secondary-foreground",
        destructive:
          "bg-destructive text-destructive-foreground",
        outline:
          "border border-border text-foreground",
        info:
          "bg-info-soft text-info-soft-foreground",
        special:
          "bg-[var(--violet-100)] text-[var(--violet-600)] dark:bg-[rgba(154,130,255,0.18)] dark:text-[var(--violet-200)]",
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
