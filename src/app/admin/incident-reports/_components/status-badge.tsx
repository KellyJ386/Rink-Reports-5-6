import { cn } from "@/lib/utils"

const STYLES: Record<string, string> = {
  submitted:
    "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  reviewed:
    "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100",
  resolved:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  archived: "bg-muted text-muted-foreground",
}

export function StatusBadge({ status }: { status: string }) {
  const cls = STYLES[status] ?? "bg-secondary text-secondary-foreground"
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize",
        cls,
      )}
    >
      {status}
    </span>
  )
}
