"use client"

import { useEffect, useRef } from "react"

import { createClient } from "@/lib/supabase/client"
import { clearDailyAreasCache } from "@/lib/offline/daily-areas-cache"
import { clearScheduleCache } from "@/lib/offline/schedule-cache"
import { setCurrentOwnerId } from "@/lib/offline/current-owner"
import { postToServiceWorker } from "@/lib/offline/use-sync-queue"

/**
 * Kiosk-safety guard for per-user offline state. Mounted app-wide in the root
 * layout (so it also covers /login, /dashboard, and /admin — not just the staff
 * shell). Wipes the per-user IndexedDB schedule cache AND quarantines the offline
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
      // Deterministic mount-time reconciliation. The Supabase SIGNED_OUT event
      // does not reliably fire during the server-driven logout navigation
      // (src/app/(auth)/logout/route.ts), and logout can start from /dashboard
      // or /admin — so relying on the event alone leaves the previous user's
      // offline state on disk. Because this listener now mounts app-wide, a
      // fresh page load after ANY logout lands here with no session: reconcile
      // the origin-global queue against the current owner (delete anything not
      // owned by them), and when nobody is signed in also wipe the per-user
      // schedule / daily-areas caches so nothing survives for the next user.
      void postToServiceWorker({
        type: "QUARANTINE_FOREIGN",
        currentOwnerId: uid,
      })
      if (!uid) {
        void clearScheduleCache()
        void clearDailyAreasCache()
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const uid = session?.user?.id ?? null
      if (event === "SIGNED_OUT") {
        void clearScheduleCache()
        void clearDailyAreasCache()
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
        // A different user signed in on this device — drop the prior caches
        // and quarantine the previous user's queued submissions.
        void clearScheduleCache()
        void clearDailyAreasCache()
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
