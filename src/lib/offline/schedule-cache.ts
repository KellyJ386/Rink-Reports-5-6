// Per-user, client-side IndexedDB cache of the signed-in employee's own
// published shifts, so the dedicated /offline-schedule view can render them
// when the device is offline.
//
// Kiosk-safety: this is its OWN database (separate from the service worker's
// `rink-offline-queue`), keyed by the auth user id. Reads are always scoped to
// the CURRENT user id, and the cache is wiped on sign-out / user-switch by
// src/components/app/auth-state-listener.tsx — so one user can never render
// another user's cached schedule on a shared device.

const DB_NAME = "rink-schedule-cache"
const DB_VERSION = 1
const STORE = "myschedule"

export type CachedShift = {
  id: string
  starts_at: string
  ends_at: string
  role_label: string | null
  status: string
  department_id: string | null
  departments: { name: string } | null
}

export type CachedSchedule = {
  userId: string
  employeeId: string
  timezone: string | null
  shifts: CachedShift[]
  cachedAt: number
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested; no IndexedDB)
// ---------------------------------------------------------------------------

/** Whether a cache snapshot is younger than ttlMs (default 7 days). */
export function isFresh(
  cachedAt: number,
  ttlMs: number = 7 * 24 * 60 * 60 * 1000,
  now: number = Date.now()
): boolean {
  return now - cachedAt < ttlMs
}

/** Keep only shifts that start within [fromMs, toMs], sorted ascending. */
export function shiftsInWindow(
  shifts: CachedShift[],
  fromMs: number,
  toMs: number
): CachedShift[] {
  return shifts
    .filter((s) => {
      const t = new Date(s.starts_at).getTime()
      return !Number.isNaN(t) && t >= fromMs && t <= toMs
    })
    .sort(
      (a, b) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
    )
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

/** Upsert the current user's cached schedule. Best-effort (swallows errors). */
export async function putMySchedule(record: CachedSchedule): Promise<void> {
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

/** Read the cached schedule for a specific user id (null if none). */
export async function getMySchedule(
  userId: string
): Promise<CachedSchedule | null> {
  try {
    const db = await openDB()
    const result = await new Promise<CachedSchedule | null>(
      (resolve, reject) => {
        const tx = db.transaction(STORE, "readonly")
        const req = tx.objectStore(STORE).get(userId)
        req.onsuccess = () => resolve((req.result as CachedSchedule) ?? null)
        req.onerror = () => reject(req.error)
      }
    )
    db.close()
    return result
  } catch {
    return null
  }
}

/** Wipe every cached schedule. Called on sign-out / user-switch. */
export async function clearScheduleCache(): Promise<void> {
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
