"use client"

import { useEffect, useState } from "react"

export interface SyncQueueState {
  pendingCount: number
  failedCount: number
  isOnline: boolean
}

/**
 * Subscribes to service worker messages about the offline sync queue.
 * Also tracks navigator.onLine for the offline banner.
 */
export function useSyncQueue(): SyncQueueState {
  const [state, setState] = useState<SyncQueueState>({
    pendingCount: 0,
    failedCount: 0,
    isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  })

  useEffect(() => {
    function handleOnline() {
      setState((s) => ({ ...s, isOnline: true }))
    }
    function handleOffline() {
      setState((s) => ({ ...s, isOnline: false }))
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    // Ask SW for current queue state
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "GET_QUEUE" })
    }

    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "SYNC_QUEUE_UPDATE") {
        setState((s) => ({
          ...s,
          pendingCount: event.data.pendingCount ?? 0,
          failedCount: event.data.failedCount ?? 0,
        }))
      }
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", handleMessage)
    }

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", handleMessage)
      }
    }
  }, [])

  return state
}

/** Enqueue a submission into the offline sync queue via the service worker. */
export function enqueueSubmission(opts: {
  localId: string
  moduleKey: string
  action?: string
  payload: Record<string, unknown>
}) {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) {
    return false
  }
  navigator.serviceWorker.controller.postMessage({
    type: "ENQUEUE_SUBMISSION",
    localId: opts.localId,
    moduleKey: opts.moduleKey,
    action: opts.action ?? "submit",
    payload: opts.payload,
    startedAt: Date.now(),
  })
  return true
}

/** Tell the service worker to retry all failed items. */
export function retryFailedSubmissions() {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return
  navigator.serviceWorker.controller.postMessage({ type: "RETRY_FAILED" })
}
