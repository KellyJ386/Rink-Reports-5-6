import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[8px] text-sm font-extrabold uppercase tracking-[0.06em] transition-[transform,box-shadow,background-color,color] duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-[var(--ring)]/40 focus-visible:ring-[3px] focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:ring-destructive/30 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        // Primary — flat RinkReports green, deep-navy ink, hard 2px green lip.
        default:
          "bg-primary text-primary-foreground shadow-[var(--shadow-press-primary)] hover:bg-[var(--primary-hover)] active:translate-y-px",
        // back-compat alias (the gradient look is retired; primary is now flat)
        gradient:
          "bg-primary text-primary-foreground shadow-[var(--shadow-press-primary)] hover:bg-[var(--primary-hover)] active:translate-y-px",
        warm:
          "bg-accent-warm text-[var(--accent-warm-foreground)] shadow-[var(--shadow-press-warm)] hover:opacity-95 active:translate-y-px",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[var(--shadow-elev-1)] hover:bg-destructive/92 focus-visible:ring-destructive/35",
        // Secondary / outline — white surface, navy ink, 1px line border.
        outline:
          "border border-border bg-card text-foreground-strong shadow-[var(--shadow-elev-1)] hover:bg-accent",
        secondary:
          "border border-border bg-card text-foreground-strong shadow-[var(--shadow-elev-1)] hover:bg-accent",
        ghost:
          "text-foreground-strong hover:bg-accent",
        // Link is text-only: opt out of the pressable uppercase chrome.
        link: "font-semibold normal-case tracking-normal text-[var(--accent-brand)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-[18px] py-2 has-[>svg]:px-3",
        sm: "h-9 gap-1.5 px-3 text-xs has-[>svg]:px-2.5",
        lg: "h-12 px-6 text-base has-[>svg]:px-4",
        icon: "size-11",
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
