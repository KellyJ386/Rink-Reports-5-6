"use client"

import { useEffect, useRef } from "react"

import { createClient } from "@/lib/supabase/client"
import { clearDailyAreasCache } from "@/lib/offline/daily-areas-cache"
import { clearScheduleCache } from "@/lib/offline/schedule-cache"
import {
  getCurrentOwnerId,
  setCurrentOwnerId,
} from "@/lib/offline/current-owner"
import { postToServiceWorker } from "@/lib/offline/use-sync-queue"

/**
 * Kiosk-safety guard for per-user offline state. Mounted app-wide in the root
 * layout (so it also covers /login, /dashboard, and /admin — not just the staff
 * shell). Wipes the per-user IndexedDB schedule / daily-areas caches AND
 * quarantines the offline submission queue when a DIFFERENT user is signed in on
 * the same device, so one user can never read another's cached shifts or have
 * their queued reports replayed under a different session (E-01). Renders
 * nothing.
 *
 * INVARIANT (R-1) — destructive reconciliation runs ONLY against a POSITIVELY
 * RESOLVED owner. An absent or indeterminate session is never treated as a user
 * switch: `getSession()` reports no session when the access token has expired
 * AND the refresh can't reach the network, which is precisely the state of a
 * driver who has been logging reports offline for over an hour (JWT TTL is
 * 3600s) — and the queue holds the only copy of those reports. The same applies
 * to the automatic `/login?redirectTo=…` bounce on an expired cookie. Privacy is
 * still upheld without mount-time purging: the SW no longer hands `payload` to
 * pages, and a foreign-owner replay is rejected 422 by /api/offline-sync, so a
 * surviving item cannot be read or re-attributed. Cache reads are uid-scoped, so
 * a stale foreign cache is unreadable rather than a leak. Only two deliberate
 * events purge: a real SIGNED_OUT (caches only), and a different user signing in
 * (caches + that other user's queued items).
 */
export function AuthStateListener() {
  const lastUserId = useRef<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    // Last owner recorded on this device. It is persisted (current-owner.ts), so
    // a user switch is still detectable on a fresh page load — the Supabase
    // SIGNED_OUT event does not reliably fire during the server-driven logout
    // navigation (src/app/(auth)/logout/route.ts), and logout can start from
    // /dashboard or /admin.
    lastUserId.current = getCurrentOwnerId()

    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id ?? null
      // No resolved session → INDETERMINATE, not a sign-out. Leave the owner
      // stamp, the queue and the caches exactly as they are (see INVARIANT).
      if (!uid) return
      const previous = lastUserId.current
      lastUserId.current = uid
      setCurrentOwnerId(uid)
      if (previous && previous !== uid) {
        // Deterministic mount-time reconciliation for a user switch that
        // happened without a SIGNED_OUT event.
        void clearScheduleCache()
        void clearDailyAreasCache()
      }
      // Reconcile the origin-global queue against the resolved owner even when
      // `previous` is unknown (e.g. localStorage cleared while IndexedDB was
      // kept) — the SW drops only items stamped with a different owner.
      void postToServiceWorker({
        type: "QUARANTINE_FOREIGN",
        currentOwnerId: uid,
      })
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const uid = session?.user?.id ?? null
      if (event === "SIGNED_OUT") {
        // A deliberate sign-out: drop the per-user caches, which are read-through
        // copies of server data and are refetched on the next online load. The
        // QUEUE is deliberately kept — it is the only copy of work that never
        // reached the server, and it is already inert for anyone else (owner
        // stamped, `payload` never exposed to pages, foreign replay 422s). It is
        // dropped below if a different user actually signs in.
        void clearScheduleCache()
        void clearDailyAreasCache()
        setCurrentOwnerId(null)
        lastUserId.current = null
        return
      }
      if (uid && uid !== lastUserId.current) {
        if (lastUserId.current) {
          // A different user signed in on this device — drop the prior caches.
          void clearScheduleCache()
          void clearDailyAreasCache()
        }
        // Quarantine anything queued by someone other than the new owner.
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
