"use client"

import { useEffect, useState } from "react"
import { RefreshCw, AlertCircle, CheckCircle2, Clock } from "lucide-react"

import { useSyncQueue, retryFailedSubmissions } from "@/lib/offline/use-sync-queue"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface QueueItem {
  localId: string
  moduleKey: string
  action: string
  status: "pending" | "failed"
  startedAt: number
  retryCount: number
  lastError: string | null
  payload: Record<string, unknown>
}

const MODULE_LABELS: Record<string, string> = {
  daily_reports: "Daily Reports",
  ice_depth: "Ice Depth",
  ice_operations: "Ice Operations",
  incident_reports: "Incident Reports",
  accident_reports: "Accident Reports",
  refrigeration: "Refrigeration",
  air_quality: "Air Quality",
  scheduling: "Scheduling",
  communications: "Communications",
}

export function OfflineQueueView() {
  const { pendingCount, failedCount, isOnline } = useSyncQueue()
  const [items, setItems] = useState<QueueItem[]>([])

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "SYNC_QUEUE_UPDATE" && event.data.items) {
        setItems(event.data.items)
      }
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", handleMessage)
      // Request current state
      navigator.serviceWorker.controller?.postMessage({ type: "GET_QUEUE" })
    }

    return () => {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", handleMessage)
      }
    }
  }, [])

  const hasItems = pendingCount > 0 || failedCount > 0

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Pending Sync Queue</h1>
        <p className="text-sm text-muted-foreground">
          Submissions captured while offline. They will sync automatically when
          you reconnect.
        </p>
      </div>

      {/* Status summary */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span
            className={cn(
              "inline-flex h-2 w-2 rounded-full",
              isOnline ? "bg-green-500" : "bg-amber-500"
            )}
            aria-hidden
          />
          {isOnline ? "Online" : "Offline"}
        </div>
        {pendingCount > 0 && (
          <Badge variant="secondary">
            <Clock className="mr-1 h-3 w-3" aria-hidden />
            {pendingCount} pending
          </Badge>
        )}
        {failedCount > 0 && (
          <Badge variant="destructive">
            <AlertCircle className="mr-1 h-3 w-3" aria-hidden />
            {failedCount} failed
          </Badge>
        )}
        {failedCount > 0 && (
          <Button size="sm" variant="outline" onClick={retryFailedSubmissions}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden />
            Retry failed
          </Button>
        )}
      </div>

      {!hasItems && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <CheckCircle2 className="h-8 w-8 text-green-500" aria-hidden />
            <p className="font-medium">Queue is empty</p>
            <p className="text-sm text-muted-foreground">
              All submissions have been synced.
            </p>
          </CardContent>
        </Card>
      )}

      {hasItems && items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Loading queue items…
        </p>
      )}

      {items.map((item) => (
        <Card
          key={item.localId}
          className={cn(
            "border-l-4",
            item.status === "failed"
              ? "border-l-destructive"
              : "border-l-amber-500"
          )}
        >
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-base">
                {MODULE_LABELS[item.moduleKey] ?? item.moduleKey}
              </CardTitle>
              <Badge variant={item.status === "failed" ? "destructive" : "secondary"}>
                {item.status}
              </Badge>
            </div>
            <CardDescription>
              Queued{" "}
              {new Date(item.startedAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
              {item.retryCount > 0 && ` · ${item.retryCount} attempt${item.retryCount === 1 ? "" : "s"}`}
            </CardDescription>
          </CardHeader>
          {item.lastError && (
            <CardContent>
              <p className="text-xs text-destructive">
                Last error: {item.lastError}
              </p>
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  )
}
