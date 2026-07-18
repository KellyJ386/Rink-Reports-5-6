// Per-user, client-side IndexedDB cache of the signed-in employee's resolved
// "My Areas Today" model, so the dedicated /offline-daily view can render it
// when the device is offline (D9: read-only server→client sync; assignment
// CHANGES stay online-only).
//
// Kiosk-safety mirrors src/lib/offline/schedule-cache.ts: its OWN database
// (separate from the SW's `rink-offline-queue`), keyed by auth user id, wiped
// on sign-out / user-switch by src/components/app/auth-state-listener.tsx.
//
// Entitlement note (the discovery doc's Phase 6 caveat): every record here is
// a verbatim snapshot of what the SERVER rendered for this user through RLS —
// the client never queries beyond its own resolved model, so the cache can
// only ever hold rows the user was entitled to at snapshot time. Assignments
// are day-scoped, so freshness is keyed on the facility-local BUSINESS DATE
// (isCacheForToday), not a wall-clock TTL: yesterday's snapshot self-
// invalidates the moment the facility's day rolls over.

import { businessDateInTimeZone } from "@/app/reports/daily/_lib/compute"

const DB_NAME = "rink-daily-areas-cache"
const DB_VERSION = 1
const STORE = "myareas"

export type CachedAreaStatus = {
  id: string
  slug: string
  name: string
  color: string | null
  assignedToMe: boolean
  done: boolean
  templatesDone: number
  templatesTotal: number
}

export type CachedMyAreas = {
  userId: string
  timezone: string | null
  /** Facility-local business date the snapshot was resolved for. */
  businessDate: string
  routingEnabled: boolean
  myAreas: CachedAreaStatus[]
  openAreas: CachedAreaStatus[]
  cachedAt: number
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested; no IndexedDB)
// ---------------------------------------------------------------------------

/**
 * Whether the snapshot still describes "today" in the facility's timezone.
 * A snapshot from a previous business date must not render as current —
 * assignments are per-day.
 */
export function isCacheForToday(
  record: Pick<CachedMyAreas, "businessDate" | "timezone">,
  now: Date = new Date(),
): boolean {
  return record.businessDate === businessDateInTimeZone(now, record.timezone)
}

// ---------------------------------------------------------------------------
// IndexedDB access (client only)
// ---------------------------------------------------------------------------

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "userId" })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Upsert the current user's snapshot. Best-effort (swallows errors). */
export async function putMyAreas(record: CachedMyAreas): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.objectStore(STORE).put(record)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // Caching is best-effort; never break the page on a storage error.
  }
}

/** Read the snapshot for a specific user id (null if none). */
export async function getMyAreas(
  userId: string,
): Promise<CachedMyAreas | null> {
  try {
    const db = await openDB()
    const result = await new Promise<CachedMyAreas | null>(
      (resolve, reject) => {
        const tx = db.transaction(STORE, "readonly")
        const req = tx.objectStore(STORE).get(userId)
        req.onsuccess = () => resolve((req.result as CachedMyAreas) ?? null)
        req.onerror = () => reject(req.error)
      },
    )
    db.close()
    return result
  } catch {
    return null
  }
}

/** Wipe every snapshot. Called on sign-out / user-switch. */
export async function clearDailyAreasCache(): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.objectStore(STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // ignore
  }
}
