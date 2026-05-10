import { Badge } from "@/components/ui/badge"
import type { BadgeProps } from "@/components/ui/badge"

function statusVariant(status: string): BadgeProps["variant"] {
  if (status === "submitted") return "warning"
  if (status === "reviewed") return "info"
  if (status === "resolved") return "success"
  if (status === "archived") return "secondary"
  return "secondary"
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={statusVariant(status)} className="capitalize">
      {status}
    </Badge>
  )
}
