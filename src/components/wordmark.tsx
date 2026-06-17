import Link from "next/link"

import { cn } from "@/lib/utils"

interface WordmarkProps {
  href?: string
  onClick?: () => void
  className?: string
  /** Tile + accent size. `sm` for dense headers, `md` (default) for sidebars. */
  size?: "sm" | "md"
}

// RinkReports brand mark: a green "R" tile + Anton wordmark whose "Reports"
// half is the brand green. The base text inherits `currentColor`, so the mark
// reads navy on the white top bar and white on the navy sidebar without any
// per-surface overrides; only the tile and the "Reports" accent stay green.
export function Wordmark({
  href = "/dashboard",
  onClick,
  className,
  size = "md",
}: WordmarkProps) {
  const tile = size === "sm" ? "h-7 w-7 text-sm" : "h-8 w-8 text-base"
  const text = size === "sm" ? "text-base" : "text-lg"

  return (
    <Link
      href={href}
      onClick={onClick}
      aria-label="RinkReports home"
      className={cn("flex items-center gap-2.5", className)}
    >
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-lg bg-rr-green font-black leading-none text-rr-navy-dark",
          tile,
        )}
        aria-hidden
      >
        R
      </span>
      <span
        className={cn(
          "font-display uppercase leading-none tracking-wide",
          text,
        )}
      >
        Rink<span className="text-rr-green">Reports</span>
      </span>
    </Link>
  )
}
