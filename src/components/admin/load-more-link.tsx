// "Load more" affordance for server-rendered admin lists: a plain link that
// re-requests the page with a larger ?show= window (see src/lib/pagination.ts),
// so it works without client state and preserves the active filters.

import Link from "next/link"

import { Button } from "@/components/ui/button"

export function LoadMoreLink({
  href,
  shown,
}: {
  href: string
  /** How many rows are currently rendered (for the hint text). */
  shown: number
}) {
  return (
    <div className="flex flex-col items-center gap-1 py-2">
      <Button variant="outline" asChild>
        <Link href={href} prefetch={false} scroll={false}>
          Load more
        </Link>
      </Button>
      <p className="text-muted-foreground text-xs">Showing first {shown}</p>
    </div>
  )
}
