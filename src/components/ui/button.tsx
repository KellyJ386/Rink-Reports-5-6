import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-bold tracking-tight transition-[transform,box-shadow,background-color,color] duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-[var(--ring)]/40 focus-visible:ring-[3px] focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:ring-destructive/30 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        // Signature pressable primary — green gradient + hard-bottom lip + soft green glow.
        // Spec: linear-gradient(180deg, green-400, green-500) light · (green-200, green-300) dark.
        default:
          "bg-gradient-to-b from-[var(--green-400)] to-[var(--green-500)] text-primary-foreground shadow-[var(--shadow-press-primary)] hover:from-[var(--green-500)] hover:to-[var(--green-600)] active:translate-y-px dark:from-[var(--green-200)] dark:to-[var(--green-300)] dark:text-[var(--navy-800)]",
        gradient:
          "bg-gradient-to-b from-[var(--green-400)] to-[var(--green-500)] text-primary-foreground shadow-[var(--shadow-press-primary)] hover:from-[var(--green-500)] hover:to-[var(--green-600)] active:translate-y-px dark:from-[var(--green-200)] dark:to-[var(--green-300)] dark:text-[var(--navy-800)]",
        warm:
          "bg-gradient-to-b from-[var(--coral-300)] to-[var(--coral-400)] text-white shadow-[var(--shadow-press-warm)] hover:from-[var(--coral-400)] hover:to-[var(--coral-500)] active:translate-y-px dark:from-[var(--coral-200)] dark:to-[var(--coral-300)] dark:text-[var(--navy-800)]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[var(--shadow-elev-1)] hover:bg-destructive/92 focus-visible:ring-destructive/35",
        outline:
          "border border-input bg-card text-foreground shadow-[var(--shadow-elev-1)] hover:bg-accent hover:text-accent-foreground hover:border-input dark:bg-card/60 dark:hover:bg-accent/70",
        secondary:
          "bg-secondary text-secondary-foreground shadow-[var(--shadow-elev-1)] border border-input hover:bg-accent",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/70",
        link: "text-[var(--accent-brand)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-[18px] py-2 has-[>svg]:px-3",
        sm: "h-9 rounded-md gap-1.5 px-3 text-xs has-[>svg]:px-2.5",
        lg: "h-12 rounded-md px-6 text-base has-[>svg]:px-4",
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
