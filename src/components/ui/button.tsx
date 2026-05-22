import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-[var(--accent-brand)]/55 focus-visible:ring-[3px] focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:ring-destructive/30 dark:aria-invalid:ring-destructive/45 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[var(--shadow-elev-1)] hover:bg-primary/92 hover:shadow-[var(--shadow-elev-2)] active:translate-y-px",
        gradient:
          "bg-gradient-to-b from-primary to-primary/85 text-primary-foreground shadow-[var(--shadow-elev-2)] hover:from-primary hover:to-primary/95 active:translate-y-px",
        destructive:
          "bg-destructive text-white shadow-[var(--shadow-elev-1)] hover:bg-destructive/92 focus-visible:ring-destructive/35 dark:bg-destructive/70",
        outline:
          "border border-border/80 bg-card text-foreground shadow-[var(--shadow-elev-1)] hover:bg-accent hover:text-accent-foreground hover:border-border dark:bg-card/60 dark:hover:bg-accent/60",
        secondary:
          "bg-secondary text-secondary-foreground shadow-[var(--shadow-elev-1)] hover:bg-secondary/85",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/60",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 text-xs has-[>svg]:px-2.5",
        lg: "h-11 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
