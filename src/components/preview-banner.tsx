import { Eye } from "lucide-react"

import { getPreviewContext } from "@/lib/auth/preview"
import { stopPreview } from "@/lib/auth/preview-actions"

/**
 * Async server component. Renders a sticky banner across the top of any
 * layout that includes it when an admin has started "Preview as employee".
 * Returns null when no preview is active so it's safe to mount everywhere.
 */
export async function PreviewBanner() {
  const ctx = await getPreviewContext()
  if (!ctx.active || !ctx.target) return null

  return (
    <div className="sticky top-0 z-40 border-b border-warning/40 bg-warning-soft text-warning-soft-foreground">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm lg:px-6">
        <Eye className="size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <span className="font-semibold">
            Previewing as {ctx.target.fullName}
          </span>
          {ctx.target.roleDisplayName ? (
            <span className="opacity-80">
              {" "}
              · {ctx.target.roleDisplayName}
            </span>
          ) : null}
          <span className="opacity-80">
            {" "}
            · Module visibility is narrowed. RLS still runs as your account, so
            data lists may still show your full facility view.
          </span>
        </div>
        <form action={stopPreview}>
          <button
            type="submit"
            className="rounded-md border border-warning/50 bg-warning/20 px-3 py-1 text-xs font-medium hover:bg-warning/35"
          >
            Stop preview
          </button>
        </form>
      </div>
    </div>
  )
}
