import * as React from "react"

import { cn } from "@/lib/utils"

export type ModuleKey =
  | "daily"
  | "ice-depth"
  | "ice-ops"
  | "incidents"
  | "accidents"
  | "refrig"
  | "air"
  | "comms"
  | "scheduling"
  | "paperwork"

/**
 * Static map so Tailwind's JIT scanner sees each literal utility class.
 * Don't switch to a template-literal lookup — the scanner can't infer
 * `text-module-${key}` at build time and the classes won't ship.
 */
const MODULE_EYEBROW_COLOR: Record<ModuleKey, string> = {
  daily: "text-module-daily",
  "ice-depth": "text-module-ice-depth",
  "ice-ops": "text-module-ice-ops",
  incidents: "text-module-incidents",
  accidents: "text-module-accidents",
  refrig: "text-module-refrig",
  air: "text-module-air",
  comms: "text-module-comms",
  scheduling: "text-module-scheduling",
  paperwork: "text-module-paperwork",
}

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
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  breadcrumb,
  variant = "default",
  module,
  className,
  ...props
}: PageHeaderProps) {
  if (variant === "display") {
    const eyebrowColor = module
      ? MODULE_EYEBROW_COLOR[module]
      : "text-muted-foreground"
    return (
      <div
        className={cn(
          "flex flex-col gap-3 pb-2 sm:flex-row sm:items-end sm:justify-between sm:gap-6",
          className,
        )}
        {...props}
      >
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
