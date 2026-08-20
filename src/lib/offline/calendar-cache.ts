// Read-only offline cache for the rink booking calendar.
//
// WHY READ-ONLY. Every write in the Rink Scheduling module requires a live
// connection, deliberately. Booking conflicts are prevented by a Postgres
// exclusion constraint that re-checks at the moment of insert; a booking
// queued offline would be validated against a world that has since moved on,
// and replaying it could either fail confusingly hours later or, worse, be
// accepted after someone else took the slot. Viewing offline is genuinely
// useful at a rink with unreliable wifi, so the read path is cached and the write
// path is refused with a clear message.
//
// Hand-rolled IndexedDB rather than a wrapper library, matching the four
// caches already in this directory (schedule, daily areas, daily forms, dasher
// perimeter). Caching is best-effort throughout: a storage failure must never
// break the page.
//
// KIOSK SAFETY. Keyed by userId, and clearCalendarCache() is called from
// auth-state-listener on sign-out and on user switch. Rinks are shared
// devices; one person's schedule must not survive into the next person's
// session.

const DB_NAME = "rink-calendar-cache"
const DB_VERSION = 1
const STORE = "calendar"

/** Rolling window held offline. Matches the spec's -7/+60 days: far enough
 *  back to answer "who had the ice last Tuesday", far enough forward to cover
 *  a season's worth of booked contracts without unbounded growth. */
export const CACHE_BEFORE_DAYS = 7
export const CACHE_AFTER_DAYS = 60

/** Cached bookings go stale quickly in a busy rink; a day is long enough to
 *  survive an outage and short enough that nobody plans off week-old data. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export type CachedBooking = {
  id: string
  rinkId: string
  rinkName: string
  rinkShortCode: string
  typeName: string
  typeColor: string
  customerName: string | null
  title: string | null
  startsAt: string
  endsAt: string
  bufferMinutesAfter: number
  status: string
  coverageStatus: string
}

export type CachedCalendar = {
  userId: string
  facilityId: string
  timeZone: string | null
  cachedAt: string
  rinks: Array<{ id: string; name: string; shortCode: string; color: string }>
  bookings: CachedBooking[]
}

// --- Pure helpers (unit-tested; no IndexedDB) ------------------------------

export function isFresh(cachedAtIso: string, nowMs: number): boolean {
  const then = new Date(cachedAtIso).getTime()
  if (!Number.isFinite(then)) return false
  // A timestamp in the future means a clock changed under us; treat it as
  // usable rather than throwing the whole cache away.
  if (then > nowMs) return true
  return nowMs - then <= CACHE_TTL_MS
}

/** Trim to the rolling window before storing, so the cache cannot grow without
 *  bound on a device that is left signed in for a season. */
export function bookingsInWindow(
  bookings: CachedBooking[],
  nowMs: number,
): CachedBooking[] {
  const from = nowMs - CACHE_BEFORE_DAYS * 86_400_000
  const to = nowMs + CACHE_AFTER_DAYS * 86_400_000
  return bookings.filter((b) => {
    const start = new Date(b.startsAt).getTime()
    return Number.isFinite(start) && start >= from && start <= to
  })
}

/** Bookings for one facility-local day key, in start order. The day key is
 *  computed by the caller against the facility zone; comparing ISO prefixes
 *  here would use UTC and silently drop evening bookings. */
export function bookingsForDayKey(
  bookings: CachedBooking[],
  dayKey: string,
  toDayKey: (iso: string) => string,
): CachedBooking[] {
  return bookings
    .filter((b) => toDayKey(b.startsAt) === dayKey)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
}

// --- IndexedDB -------------------------------------------------------------

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

export async function putCalendar(payload: CachedCalendar): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.objectStore(STORE).put(payload)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // Best-effort: never break the page over a storage error.
  }
}

export async function getCalendar(userId: string): Promise<CachedCalendar | null> {
  try {
    const db = await openDB()
    const result = await new Promise<CachedCalendar | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly")
      const req = tx.objectStore(STORE).get(userId)
      req.onsuccess = () => resolve((req.result as CachedCalendar) ?? null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return result
  } catch {
    return null
  }
}

export async function clearCalendarCache(): Promise<void> {
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
    // Best-effort.
  }
}
