"use client"

import { useState, type FormEvent } from "react"

import { enqueueSubmission, useSyncQueue } from "@/lib/offline/use-sync-queue"
import { genLocalId } from "@/lib/offline/local-id"

/**
 * Shared offline-submit plumbing for the four ice-operations forms. When the
 * device is offline (and the service worker is controlling the page), the
 * submission is serialized into the SAME payload shape `buildInputFromPayload`
 * parses — INCLUDING the `operation_type` discriminator — and queued via the SW,
 * which replays it to `/api/offline-sync` (running the same validation + persist
 * as the online server action) once back online. Otherwise the form falls
 * through to its normal server action (the online path is untouched).
 *
 * `buildPayload` should return the per-op payload object. The hook stamps
 * `operation_type` on it so callers don't have to remember.
 */
export function useOfflineSubmit(
  operationType: string,
  buildPayload: () => Record<string, unknown>
) {
  const { isOnline } = useSyncQueue()
  const [localId] = useState<string>(genLocalId)
  const [queued, setQueued] = useState(false)

  // Wrap a form's onSubmit. When offline, prevent the network action and queue
  // the submission instead, flipping into the "saved on this device" state.
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const ok = enqueueSubmission({
        localId,
        moduleKey: "ice_operations",
        action: "submit",
        payload: { ...buildPayload(), operation_type: operationType },
      })
      if (ok) {
        e.preventDefault()
        setQueued(true)
      }
    }
  }

  return { isOnline, queued, handleSubmit }
}
