import * as React from "react"

import { cn } from "@/lib/utils"
import {
  MODULE_ACCENT_VAR,
  MODULE_BORDER_L,
  MODULE_TEXT,
  type ModuleKey,
} from "@/components/ui/module-theme"

/**
 * Canonical visual chrome shared by SectionCard and disclosure-style
 * `<details>` containers (refrigeration). Kept here so both stay in
 * sync if the baseline shifts.
 */
export const sectionCardClasses =
  "bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-elev-1)] flex flex-col"

interface SectionCardProps extends React.HTMLAttributes<HTMLElement> {
  as?: "section" | "div" | "article"
  /** Per-module theming key. With `accentBorder`, paints a colored left rule. */
  module?: ModuleKey
  /** When true (and `module` set), adds a module-colored left accent border. */
  accentBorder?: boolean
}

export function SectionCard({
  as = "section",
  module,
  accentBorder = false,
  className,
  children,
  ...props
}: SectionCardProps) {
  const Comp = as as React.ElementType
  const accent =
    accentBorder && module
      ? cn("border-l-4", MODULE_BORDER_L[module])
      : undefined
  return (
    <Comp className={cn(sectionCardClasses, accent, className)} {...props}>
      {children}
    </Comp>
  )
}

interface SectionHeadProps {
  n?: number
  title: React.ReactNode
  sub?: React.ReactNode
  eyebrow?: React.ReactNode
  icon?: React.ReactNode
  /**
   * Module accent CSS var name (e.g. "--module-accidents"); colors the eyebrow.
   * Prefer `module` for new code — kept for back-compat.
   */
  accent?: string
  /** Per-module theming key; colors the eyebrow and the icon badge background. */
  module?: ModuleKey
  className?: string
}

export function SectionHead({
  n,
  title,
  sub,
  eyebrow,
  icon,
  accent,
  module,
  className,
}: SectionHeadProps) {
  // `module` takes precedence; fall back to the legacy `accent` CSS-var string.
  const accentVar = module ? `var(${MODULE_ACCENT_VAR[module]})` : accent ? `var(${accent})` : undefined
  const eyebrowClass = module ? MODULE_TEXT[module] : undefined
  return (
    <header className={cn("mb-4 flex items-center gap-3.5", className)}>
      {typeof n === "number" ? (
        <div
          className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--navy-700)] font-display text-lg text-white"
          aria-hidden="true"
        >
          {n}
        </div>
      ) : icon ? (
        <div
          className="grid size-11 shrink-0 place-items-center rounded-[10px] text-white"
          style={accentVar ? { background: accentVar } : undefined}
          aria-hidden="true"
        >
          {icon}
        </div>
      ) : null}
      <div className="min-w-0">
        {eyebrow ? (
          <div
            className={cn(
              "text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground",
              eyebrowClass,
            )}
            style={!module && accent ? { color: `var(${accent})` } : undefined}
          >
            {eyebrow}
          </div>
        ) : null}
        <h3 className="font-display text-[22px] leading-none tracking-[-0.01em] uppercase text-foreground m-0">
          {title}
        </h3>
        {sub ? (
          <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
        ) : null}
      </div>
    </header>
  )
}
