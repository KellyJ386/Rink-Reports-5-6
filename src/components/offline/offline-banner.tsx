"use client"

import { WifiOff } from "lucide-react"

import { useSyncQueue } from "@/lib/offline/use-sync-queue"
import { cn } from "@/lib/utils"

export function OfflineBanner() {
  const { isOnline, pendingCount } = useSyncQueue()

  if (isOnline) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-2 bg-warning px-4 py-2 text-sm font-medium text-warning-foreground",
        "w-full"
      )}
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        You are offline.
        {pendingCount > 0
          ? ` ${pendingCount} submission${pendingCount === 1 ? "" : "s"} will sync when reconnected.`
          : " Submissions will be queued and sent when you reconnect."}
      </span>
    </div>
  )
}
