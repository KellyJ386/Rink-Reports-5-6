"use client"

import { useEffect, useRef } from "react"

import { createClient } from "@/lib/supabase/client"
import { clearScheduleCache } from "@/lib/offline/schedule-cache"
import { setCurrentOwnerId } from "@/lib/offline/current-owner"
import { postToServiceWorker } from "@/lib/offline/use-sync-queue"

/**
 * Kiosk-safety guard for per-user offline state. Mounted once in the staff
 * shell. Wipes the per-user IndexedDB schedule cache AND quarantines the offline
 * submission queue when the user signs out or when a DIFFERENT user signs in on
 * the same device, so one user can never read another's cached shifts or have
 * their queued reports replayed under a different session (E-01). Renders
 * nothing.
 */
export function AuthStateListener() {
  const lastUserId = useRef<string | null>(null)

  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id ?? null
      lastUserId.current = uid
      // Seed the owner id so submissions enqueued this session are stamped with
      // the current user's auth uid.
      setCurrentOwnerId(uid)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const uid = session?.user?.id ?? null
      if (event === "SIGNED_OUT") {
        void clearScheduleCache()
        setCurrentOwnerId(null)
        // Park any queued item so nothing replays under the next session.
        void postToServiceWorker({
          type: "QUARANTINE_FOREIGN",
          currentOwnerId: null,
        })
        lastUserId.current = null
        return
      }
      if (uid && lastUserId.current && uid !== lastUserId.current) {
        // A different user signed in on this device — drop the prior cache and
        // quarantine the previous user's queued submissions.
        void clearScheduleCache()
        void postToServiceWorker({
          type: "QUARANTINE_FOREIGN",
          currentOwnerId: uid,
        })
      }
      if (uid) {
        lastUserId.current = uid
        setCurrentOwnerId(uid)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  return null
}
