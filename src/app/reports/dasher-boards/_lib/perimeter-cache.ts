// Client-side (browser) read cache for the Dasher Boards condition map,
// mirroring src/lib/offline/daily-areas-cache.ts: raw IndexedDB, one record
// per (owner, rink). The service worker serves the last HTML for offline
// navigations; this cache's job is the STALE-DATA INDICATOR — it remembers
// when the data on screen was last synced so the UI can say so while offline.

const DB_NAME = "rink-dasher-boards-cache"
const DB_VERSION = 1
const STORE = "perimeter"

export type CachedPerimeterMeta = {
  /** `${ownerId}:${rinkId}` */
  key: string
  ownerId: string
  rinkId: string
  savedAt: number
  assetCount: number
  openIssueCount: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "key" })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function putPerimeterMeta(
  record: Omit<CachedPerimeterMeta, "key">,
): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.objectStore(STORE).put({
        ...record,
        key: `${record.ownerId}:${record.rinkId}`,
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // Cache writes are best-effort; the live data already rendered.
  }
}

export async function getPerimeterMeta(
  ownerId: string,
  rinkId: string,
): Promise<CachedPerimeterMeta | null> {
  try {
    const db = await openDb()
    const result = await new Promise<CachedPerimeterMeta | null>(
      (resolve, reject) => {
        const tx = db.transaction(STORE, "readonly")
        const req = tx.objectStore(STORE).get(`${ownerId}:${rinkId}`)
        req.onsuccess = () => resolve(req.result ?? null)
        req.onerror = () => reject(req.error)
      },
    )
    db.close()
    return result
  } catch {
    return null
  }
}
