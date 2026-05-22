import * as React from "react"

import { cn } from "@/lib/utils"

interface PageHeaderProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  eyebrow?: React.ReactNode
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 pb-6 sm:flex-row sm:items-end sm:justify-between sm:gap-6",
        className,
      )}
      {...props}
    >
      <div className="min-w-0">
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
