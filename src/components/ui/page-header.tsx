import * as React from "react"

import { cn } from "@/lib/utils"
import {
  MODULE_ACCENT_VAR,
  MODULE_BORDER_L,
  MODULE_TEXT,
  type ModuleKey,
} from "@/components/ui/module-theme"

export type { ModuleKey }

interface PageHeaderProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  eyebrow?: React.ReactNode
  breadcrumb?: React.ReactNode
  /**
   * `default` keeps the existing Geist semibold heading (used by admin
   * pages). `display` switches the H1 to the Anton display font + the
   * eyebrow-above-title layout that the Accident Report uses.
   */
  variant?: "default" | "display"
  /** Selects the eyebrow accent color via `text-module-*`. */
  module?: ModuleKey
  /**
   * Display-only: render a subtle module-colored band (soft `color-mix` wash +
   * accent left-rule) behind the title. Requires `module`. Off by default so
   * existing display headers (e.g. admin) are untouched.
   */
  band?: boolean
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  breadcrumb,
  variant = "default",
  module,
  band = false,
  className,
  ...props
}: PageHeaderProps) {
  if (variant === "display") {
    const eyebrowColor = module
      ? MODULE_TEXT[module]
      : "text-muted-foreground"
    const showBand = band && module
    const inner = (
      <>
        <div className="min-w-0">
          {breadcrumb ? <div className="mb-3">{breadcrumb}</div> : null}
          {eyebrow ? (
            <p
              className={cn(
                "mb-1 text-[10px] font-extrabold uppercase tracking-[0.16em]",
                eyebrowColor,
              )}
            >
              {eyebrow}
            </p>
          ) : null}
          <h1 className="font-display text-[clamp(30px,6vw,44px)] leading-none tracking-[0.01em] uppercase text-foreground m-0">
            {title}
          </h1>
          {description ? (
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </>
    )
    if (showBand) {
      return (
        <div
          className={cn(
            "flex flex-col gap-3 overflow-hidden rounded-2xl border-l-4 px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6 sm:px-6 sm:py-5",
            MODULE_BORDER_L[module],
            className,
          )}
          style={{
            ["--module-accent" as string]: `var(${MODULE_ACCENT_VAR[module]})`,
            backgroundImage:
              "linear-gradient(120deg, color-mix(in oklab, var(--module-accent) 14%, transparent) 0%, transparent 70%)",
          }}
          {...props}
        >
          {inner}
        </div>
      )
    }
    return (
      <div
        className={cn(
          "flex flex-col gap-3 pb-2 sm:flex-row sm:items-end sm:justify-between sm:gap-6",
          className,
        )}
        {...props}
      >
        {inner}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 pb-6 sm:flex-row sm:items-end sm:justify-between sm:gap-6",
        className,
      )}
      {...props}
    >
      <div className="min-w-0">
        {breadcrumb ? <div className="mb-3">{breadcrumb}</div> : null}
        {eyebrow ? (
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  )
}
