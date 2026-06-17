import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Canonical visual chrome shared by SectionCard and disclosure-style
 * `<details>` containers (refrigeration). Kept here so both stay in
 * sync if the baseline shifts.
 */
export const sectionCardClasses =
  "bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-elev-1)] flex flex-col"

interface SectionCardProps extends React.HTMLAttributes<HTMLElement> {
  as?: "section" | "div" | "article"
}

export function SectionCard({
  as = "section",
  className,
  children,
  ...props
}: SectionCardProps) {
  const Comp = as as React.ElementType
  return (
    <Comp className={cn(sectionCardClasses, className)} {...props}>
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
  /** Module accent CSS var name (e.g. "--module-accidents"); colors the eyebrow. */
  accent?: string
  className?: string
}

export function SectionHead({
  n,
  title,
  sub,
  eyebrow,
  icon,
  accent,
  className,
}: SectionHeadProps) {
  return (
    <header className={cn("mb-4 flex items-center gap-3.5", className)}>
      {typeof n === "number" ? (
        <div
          className="grid size-9 shrink-0 place-items-center rounded-full bg-rr-navy font-display text-lg text-white"
          aria-hidden="true"
        >
          {n}
        </div>
      ) : icon ? (
        <div
          className="grid size-11 shrink-0 place-items-center rounded-[10px] text-white"
          style={accent ? { background: `var(${accent})` } : undefined}
          aria-hidden="true"
        >
          {icon}
        </div>
      ) : null}
      <div className="min-w-0">
        {eyebrow ? (
          <div
            className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground"
            style={accent ? { color: `var(${accent})` } : undefined}
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
