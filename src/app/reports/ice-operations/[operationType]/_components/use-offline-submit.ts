"use client"

import { useState, type FormEvent } from "react"
import { toast } from "sonner"

import { enqueueSubmission, useSyncQueue } from "@/lib/offline/use-sync-queue"
import { genLocalId } from "@/lib/offline/local-id"

/**
 * Shared offline-submit plumbing for the ice-operations forms. When the
 * device is offline (and the service worker is controlling the page), the
 * submission is serialized into the SAME payload shape `buildInputFromPayload`
 * parses — INCLUDING the `operation_type` discriminator — and queued via the SW,
 * which replays it to `/api/offline-sync` (running the same validation + persist
 * as the online server action) once back online. Otherwise the form falls
 * through to its normal server action (the online path is untouched).
 *
 * `buildPayload` should return the per-op payload object. The hook stamps
 * `operation_type` and `occurred_at` (submit-time ISO — an unambiguous UTC
 * instant, unlike a local `datetime-local` string, and for offline queues the
 * time the operation was logged rather than when it later syncs) so callers
 * don't have to remember either.
 */
export function useOfflineSubmit(
  operationType: string,
  buildPayload: () => Record<string, unknown>
) {
  const { isOnline } = useSyncQueue()
  const [localId] = useState<string>(genLocalId)
  const [queued, setQueued] = useState(false)

  // Wrap a form's onSubmit. When offline, prevent the network action and queue
  // the submission instead, flipping into the "saved on this device" state. If
  // the queue can't take it (no SW controlling the page yet, or no owner
  // recorded on this device), we must NOT fall through to the server action —
  // the browser already reports itself offline, so that POST would fail with a
  // confusing network error and the log would be lost. Block the submit and say
  // so.
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      e.preventDefault()
      const ok = enqueueSubmission({
        localId,
        moduleKey: "ice_operations",
        action: "submit",
        payload: {
          ...buildPayload(),
          operation_type: operationType,
          occurred_at: new Date().toISOString(),
        },
      })
      if (ok) {
        setQueued(true)
      } else {
        toast.error(
          "You're offline and the offline queue isn't ready yet. Keep this page open and try again — your entries are still here."
        )
      }
    }
  }

  return { isOnline, queued, handleSubmit }
}
