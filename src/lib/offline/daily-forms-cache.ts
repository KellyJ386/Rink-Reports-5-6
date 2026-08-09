// Per-user, client-side IndexedDB cache of the Daily Reports FORM BUILDER
// board: the active form templates for the user's areas plus today's report
// instances (including each instance's frozen template snapshot + responses),
// so the /offline-forms view can render — and queue edits — while offline.
//
// Kiosk-safety mirrors src/lib/offline/daily-areas-cache.ts: its OWN database
// (separate from the SW's `rink-offline-queue`), keyed by auth user id, wiped
// on sign-out / user-switch by src/components/app/auth-state-listener.tsx.
//
// Entitlement note: every record is a verbatim snapshot of what the SERVER
// rendered for this user through RLS — the client never queries beyond its
// own resolved board, so the cache only ever holds rows the user was entitled
// to at snapshot time. Instances are day-scoped, so freshness is keyed on the
// facility-local BUSINESS DATE (isFormsCacheForToday), not a wall-clock TTL.

import { businessDateInTimeZone } from "@/app/reports/daily/_lib/compute"
import type {
  ResponsesMap,
  TemplateSnapshot,
} from "@/app/reports/daily/_lib/instance-compute"

const DB_NAME = "rink-daily-forms-cache"
const DB_VERSION = 1
const STORE = "board"

export type CachedFormTemplate = {
  id: string
  name: string
  version: number
}

export type CachedInstance = {
  id: string
  title: string
  status: "draft" | "submitted"
  templateName: string
  ownerName: string | null
  mine: boolean
  /** Frozen snapshot + responses so the offline editor can render this instance. */
  snapshot: TemplateSnapshot
  responses: ResponsesMap
}

export type CachedFormsArea = {
  id: string
  name: string
  color: string | null
  templates: CachedFormTemplate[]
  instances: CachedInstance[]
}

export type CachedFormsBoard = {
  userId: string
  timezone: string | null
  /** Facility-local business date the snapshot was resolved for. */
  businessDate: string
  locked: boolean
  areas: CachedFormsArea[]
  cachedAt: number
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested; no IndexedDB)
// ---------------------------------------------------------------------------

/**
 * Whether the snapshot still describes "today" in the facility's timezone.
 * Instances (and the lock) are per-day, so yesterday's snapshot must not
 * render as current.
 */
export function isFormsCacheForToday(
  record: Pick<CachedFormsBoard, "businessDate" | "timezone">,
  now: Date = new Date(),
): boolean {
  return record.businessDate === businessDateInTimeZone(now, record.timezone)
}

/**
 * The cached instances the signed-in user can still EDIT offline: their own
 * drafts. Everything else renders read-only offline (someone else's report,
 * or an already-submitted one), and nothing is editable when the cached day
 * was locked.
 */
export function editableCachedInstances(
  record: Pick<CachedFormsBoard, "locked" | "areas">,
): CachedInstance[] {
  if (record.locked) return []
  return record.areas.flatMap((a) =>
    a.instances.filter((i) => i.mine && i.status === "draft"),
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

/** Upsert the current user's board snapshot. Best-effort (swallows errors). */
export async function putFormsBoard(record: CachedFormsBoard): Promise<void> {
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

/** Read the board snapshot for a specific user id (null if none). */
export async function getFormsBoard(
  userId: string,
): Promise<CachedFormsBoard | null> {
  try {
    const db = await openDB()
    const result = await new Promise<CachedFormsBoard | null>(
      (resolve, reject) => {
        const tx = db.transaction(STORE, "readonly")
        const req = tx.objectStore(STORE).get(userId)
        req.onsuccess = () => resolve((req.result as CachedFormsBoard) ?? null)
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
export async function clearDailyFormsCache(): Promise<void> {
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
