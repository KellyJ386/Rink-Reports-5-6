import { Badge } from "@/components/ui/badge"
import type { BadgeProps } from "@/components/ui/badge"

// incident_reports.status values ('reviewed' was renamed to 'in_review' in
// migration 27). Unknown values fall back to a plain badge with the raw text.
const STATUS_META: Record<
  string,
  { label: string; variant: BadgeProps["variant"] }
> = {
  submitted: { label: "Submitted", variant: "warning" },
  in_review: { label: "In review", variant: "info" },
  resolved: { label: "Resolved", variant: "success" },
  archived: { label: "Archived", variant: "secondary" },
}

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status]
  return (
    <Badge variant={meta?.variant ?? "secondary"}>{meta?.label ?? status}</Badge>
  )
}
