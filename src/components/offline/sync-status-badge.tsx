"use client"

import Link from "next/link"
import { RefreshCw, AlertCircle } from "lucide-react"

import { useSyncQueue, retryFailedSubmissions } from "@/lib/offline/use-sync-queue"
import { cn } from "@/lib/utils"

export function SyncStatusBadge() {
  const { pendingCount, failedCount, isOnline } = useSyncQueue()

  if (pendingCount === 0 && failedCount === 0) return null

  return (
    <Link
      href="/reports/offline-queue"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        failedCount > 0
          ? "bg-destructive text-destructive-foreground"
          : "bg-amber-600 text-white"
      )}
      title={
        failedCount > 0
          ? `${failedCount} submission${failedCount === 1 ? "" : "s"} failed to sync`
          : `${pendingCount} submission${pendingCount === 1 ? "" : "s"} pending sync`
      }
    >
      {failedCount > 0 ? (
        <>
          <AlertCircle className="h-3 w-3" aria-hidden />
          {failedCount} failed
        </>
      ) : (
        <>
          <RefreshCw
            className={cn("h-3 w-3", !isOnline && "animate-spin")}
            aria-hidden
          />
          {pendingCount} pending
        </>
      )}
    </Link>
  )
}
