import type { ShiftStatus } from "../types"

// Shift status → semantic token classes, shared by the my-schedule list and
// the offline schedule view so both track light/dark theme.
export const SHIFT_STATUS_TONES: Record<
  ShiftStatus,
  { borderL: string; pill: string }
> = {
  published: {
    borderL: "border-l-[var(--success-soft-foreground)]",
    pill: "bg-success-soft text-success-soft-foreground",
  },
  cancelled: {
    borderL: "border-l-[var(--muted-foreground)]",
    pill: "bg-muted text-muted-foreground",
  },
  draft: {
    borderL: "border-l-[var(--info)]",
    pill: "bg-info-soft text-info-soft-foreground",
  },
}

export function shiftStatusTone(status: string) {
  return (
    SHIFT_STATUS_TONES[status as ShiftStatus] ?? SHIFT_STATUS_TONES.cancelled
  )
}
