"use client"

import { useEffect, useRef } from "react"

import { createClient } from "@/lib/supabase/client"
import { clearScheduleCache } from "@/lib/offline/schedule-cache"

/**
 * Kiosk-safety guard for the offline schedule cache. Mounted once in the staff
 * shell. Wipes the per-user IndexedDB schedule cache when the user signs out or
 * when a DIFFERENT user signs in on the same device, so one user can never read
 * another's cached shifts. Renders nothing.
 */
export function AuthStateListener() {
  const lastUserId = useRef<string | null>(null)

  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getSession().then(({ data }) => {
      lastUserId.current = data.session?.user?.id ?? null
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const uid = session?.user?.id ?? null
      if (event === "SIGNED_OUT") {
        void clearScheduleCache()
        lastUserId.current = null
        return
      }
      if (uid && lastUserId.current && uid !== lastUserId.current) {
        // A different user signed in on this device — drop the prior cache.
        void clearScheduleCache()
      }
      if (uid) lastUserId.current = uid
    })

    return () => subscription.unsubscribe()
  }, [])

  return null
}
