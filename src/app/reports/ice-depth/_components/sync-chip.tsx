"use client"

import { useSyncQueue } from "@/lib/offline/use-sync-queue"

export function SyncChip() {
  const { pendingCount, isOnline } = useSyncQueue()

  const showOffline = !isOnline || pendingCount > 0
  const label = !isOnline
    ? pendingCount > 0
      ? `${pendingCount} queued · offline`
      : "Synced · offline"
    : pendingCount > 0
      ? `${pendingCount} queued`
      : "Synced"

  return (
    <span
      className={
        showOffline
          ? "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-warning bg-warning-soft px-2.5 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-warning-soft-foreground"
          : "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-success bg-success-soft px-2.5 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-success-soft-foreground"
      }
    >
      <span
        aria-hidden="true"
        className={
          showOffline
            ? "size-1.5 rounded-full bg-warning"
            : "size-1.5 rounded-full bg-success shadow-[0_0_0_3px_rgba(105,190,40,0.3)]"
        }
      />
      {label}
    </span>
  )
}
