// Shared pulse-skeleton primitives for admin `loading.tsx` files. Each module
// renders its real header (PageHeader or h1, so there is no layout shift when
// the page streams in) above one of these content placeholders. Tokens only —
// bg-muted / bg-card adapt to both themes.

import { cn } from "@/lib/utils"

export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("bg-muted animate-pulse rounded-md", className)} />
}

/** Search/filter toolbar + a bordered table of pulse rows. */
export function AdminTableSkeleton({
  columns = 5,
  rows = 6,
  toolbar = true,
}: {
  columns?: number
  rows?: number
  toolbar?: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
      {toolbar ? (
        <div className="flex items-center justify-between gap-2">
          <SkeletonBlock className="h-9 w-full max-w-sm" />
          <SkeletonBlock className="h-9 w-32" />
        </div>
      ) : null}
      <div className="overflow-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/60">
            <tr>
              {Array.from({ length: columns }).map((_, i) => (
                <th key={i} className="border-b px-3 py-2 text-left">
                  <SkeletonBlock className="h-4 w-20 rounded" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, i) => (
              <tr key={i}>
                {Array.from({ length: columns }).map((__, j) => (
                  <td key={j} className="border-b px-3 py-3">
                    <SkeletonBlock className="h-4 w-full rounded" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Responsive grid of pulse cards (stat tiles, settings sections, panels). */
export function AdminCardsSkeleton({
  count = 4,
  cardClassName = "h-40",
  gridClassName = "grid gap-4 sm:grid-cols-2 xl:grid-cols-4",
}: {
  count?: number
  cardClassName?: string
  gridClassName?: string
}) {
  return (
    <div className={gridClassName}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "bg-card animate-pulse rounded-xl border shadow-sm",
            cardClassName,
          )}
        />
      ))}
    </div>
  )
}
