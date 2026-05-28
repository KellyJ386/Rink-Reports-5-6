import * as React from "react"

import { sectionCardClasses } from "@/components/ui/section-card"
import { cn } from "@/lib/utils"

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

interface LoadingStateProps {
  /** Number of section-card skeletons to render below the header. */
  sections?: number
  className?: string
}

/**
 * Generic loading skeleton matching the standard
 * `PageHeader + SectionCard*N` layout. Drop into route `loading.tsx`
 * files to keep the loading shape consistent with the rendered page.
 */
export function LoadingState({ sections = 2, className }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8",
        className,
      )}
    >
      <span className="sr-only">Loading…</span>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      {Array.from({ length: sections }).map((_, i) => (
        <div key={i} className={cn(sectionCardClasses, "gap-3")}>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  )
}
