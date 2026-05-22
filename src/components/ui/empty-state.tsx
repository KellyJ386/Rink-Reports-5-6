import * as React from "react"

import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface EmptyStateProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <Card
      variant="flat"
      className={cn(
        "items-center justify-center gap-3 py-12 px-6 text-center",
        className,
      )}
      {...props}
    >
      {icon ? (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
      ) : null}
      <div className="flex flex-col items-center gap-1.5">
        <p className="text-base font-semibold text-foreground">{title}</p>
        {description ? (
          <p className="max-w-md text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </Card>
  )
}
