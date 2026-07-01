"use client"

import { useEffect, useState } from "react"

import { getCurrentOwnerId } from "./current-owner"

export interface SyncQueueState {
  pendingCount: number
  failedCount: number
  isOnline: boolean
}

/**
 * Post a message to the controlling service worker. Falls back to
 * `serviceWorker.ready` when there is no controller yet — e.g. right after a
 * hard reload, when `navigator.serviceWorker.controller` is momentarily null
 * (E-06). Returns a promise so callers can await delivery if they need to.
 */
export function postToServiceWorker(message: unknown): Promise<void> {
  if (!("serviceWorker" in navigator)) return Promise.resolve()
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage(message)
    return Promise.resolve()
  }
  return navigator.serviceWorker.ready
    .then((reg) => {
      reg.active?.postMessage(message)
    })
    .catch(() => {})
}

/**
 * Subscribes to service worker messages about the offline sync queue.
 * Also tracks navigator.onLine for the offline banner, and — because Safari/iOS
 * has no Background Sync — asks the SW to drain the queue whenever the app comes
 * back online or is brought to the foreground, so pending items don't sit
 * stranded after the SW is terminated (E-02).
 */
export function useSyncQueue(): SyncQueueState {
  const [state, setState] = useState<SyncQueueState>({
    pendingCount: 0,
    failedCount: 0,
    isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  })

  useEffect(() => {
    function requestQueue() {
      void postToServiceWorker({ type: "GET_QUEUE" })
    }
    function drainQueue() {
      // Drain ALL pending+failed items — not just failed — so a report queued
      // before the SW was terminated actually flushes on the next foreground /
      // reconnect on browsers without Background Sync.
      void postToServiceWorker({ type: "FLUSH_QUEUE" })
    }

    function handleOnline() {
      setState((s) => ({ ...s, isOnline: true }))
      drainQueue()
    }
    function handleOffline() {
      setState((s) => ({ ...s, isOnline: false }))
    }
    function handleVisibility() {
      if (document.visibilityState === "visible") {
        requestQueue()
        drainQueue()
      }
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    document.addEventListener("visibilitychange", handleVisibility)
    window.addEventListener("focus", drainQueue)

    // Ask SW for current queue state (falls back to serviceWorker.ready when the
    // page has no controller yet, e.g. after a hard reload — E-06).
    requestQueue()

    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "SYNC_QUEUE_UPDATE") {
        setState((s) => ({
          ...s,
          pendingCount: event.data.pendingCount ?? 0,
          failedCount: event.data.failedCount ?? 0,
        }))
      }
    }

    // After a hard reload the page starts uncontrolled; re-query once a
    // controller takes over so the badge/counts stop showing a false-empty
    // queue (E-06).
    function handleControllerChange() {
      requestQueue()
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", handleMessage)
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        handleControllerChange,
      )
    }

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
      document.removeEventListener("visibilitychange", handleVisibility)
      window.removeEventListener("focus", drainQueue)
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", handleMessage)
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          handleControllerChange,
        )
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
  // Stamp the OWNER (the currently signed-in user's auth uid) on the record so a
  // later flush under a different session cannot be silently re-attributed
  // (E-01). The route rejects any item whose owner ≠ the flush-time session.
  navigator.serviceWorker.controller.postMessage({
    type: "ENQUEUE_SUBMISSION",
    localId: opts.localId,
    moduleKey: opts.moduleKey,
    action: opts.action ?? "submit",
    payload: opts.payload,
    ownerId: getCurrentOwnerId(),
    startedAt: Date.now(),
  })
  return true
}

/** Tell the service worker to retry all failed items. */
export function retryFailedSubmissions() {
  void postToServiceWorker({ type: "RETRY_FAILED" })
}

/**
 * Tell the service worker to drain ALL pending+failed items now. Used by the
 * "Sync now" button and by the online/foreground triggers above (E-02).
 */
export function flushQueue() {
  void postToServiceWorker({ type: "FLUSH_QUEUE" })
}
