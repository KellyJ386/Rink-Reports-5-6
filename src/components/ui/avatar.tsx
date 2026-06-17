import * as React from "react"

import { readableForeground } from "@/lib/color-contrast"
import { cn } from "@/lib/utils"

const SIZES = {
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
  lg: "size-10 text-sm",
} as const

type AvatarProps = Omit<React.ComponentProps<"span">, "color"> & {
  /** Initials to render (1–3 chars recommended). */
  initials: string
  /** Role/person color as a hex string (e.g. a DB role color). Defaults to navy. */
  color?: string
  size?: keyof typeof SIZES
}

/**
 * Avatar — initials circle. Background is the person/role color (from the DB);
 * the foreground is auto-chosen for contrast via readableForeground so any
 * admin-configured color stays legible. No image/photo variant by design.
 */
function Avatar({
  initials,
  color,
  size = "md",
  className,
  style,
  ...props
}: AvatarProps) {
  const bg = color?.trim() || "var(--rr-navy)"
  // Only a real hex can be contrast-tested; the navy default pairs with white.
  const fg = color?.trim() ? readableForeground(color) : "#ffffff"
  return (
    <span
      data-slot="avatar"
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-extrabold uppercase leading-none tracking-[0.02em] select-none",
        SIZES[size],
        className
      )}
      style={{ backgroundColor: bg, color: fg, ...style }}
      {...props}
    >
      {initials.slice(0, 3)}
    </span>
  )
}

export { Avatar }
