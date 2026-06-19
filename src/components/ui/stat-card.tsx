import * as React from "react"

import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode
  value: React.ReactNode
  delta?: React.ReactNode
  deltaTone?: "positive" | "negative" | "neutral"
  icon?: React.ReactNode
  /** CSS var name like `--module-daily`; renders as tinted icon chip. */
  accent?: string
}

export function StatCard({
  label,
  value,
  delta,
  deltaTone = "neutral",
  icon,
  accent,
  className,
  ...props
}: StatCardProps) {
  const deltaColor =
    deltaTone === "positive"
      ? "text-success-soft-foreground"
      : deltaTone === "negative"
        ? "text-destructive-soft-foreground"
        : "text-muted-foreground"

  return (
    <Card
      className={cn("gap-2 px-5 py-5", className)}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {icon ? (
          <span
            className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={
              accent
                ? {
                    background: `color-mix(in oklab, var(${accent}) 14%, transparent)`,
                    color: `var(${accent})`,
                  }
                : { background: "var(--accent)", color: "var(--foreground)" }
            }
          >
            {icon}
          </span>
        ) : null}
      </div>
      <div className="text-3xl font-semibold tracking-tight text-foreground">
        {value}
      </div>
      {delta ? (
        <p className={cn("text-xs font-medium", deltaColor)}>{delta}</p>
      ) : null}
    </Card>
  )
}
