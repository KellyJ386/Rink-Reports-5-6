// =============================================================================
// Rink Reports — Service Worker
//
// Strategy:
//  - Navigation requests: network-first, cache fallback
//  - Static assets (_next/static): cache-first
//  - Module form submissions (POST to /api/offline-sync): queued in IndexedDB
//    when offline, replayed FIFO (by startedAt) when online
//  - Supabase API calls: always network-only (no cache)
// =============================================================================

const CACHE_NAME = "rink-reports-v2"
const STATIC_CACHE = "rink-reports-static-v2"
const DB_NAME = "rink-offline-queue"
const DB_VERSION = 1
const STORE_NAME = "submissions"

// ---------------------------------------------------------------------------
// Install: cache shell
// ---------------------------------------------------------------------------
self.addEventListener("install", () => {
  self.skipWaiting()
})

// ---------------------------------------------------------------------------
// Activate: clean old caches
// ---------------------------------------------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => n !== CACHE_NAME && n !== STATIC_CACHE)
            .map((n) => caches.delete(n))
        )
      )
      .then(() => self.clients.claim())
  )
})

// ---------------------------------------------------------------------------
// IndexedDB helpers
// ---------------------------------------------------------------------------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "localId" })
        store.createIndex("byStatus", "status", { unique: false })
        store.createIndex("byStartedAt", "startedAt", { unique: false })
      }
    }
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror = (e) => reject(e.target.error)
  })
}

function dbGetAll(db, indexName, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    const store = tx.objectStore(STORE_NAME)
    const index = store.index(indexName)
    const req = index.getAll(value)
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror = (e) => reject(e.target.error)
  })
}

function dbPut(db, record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    const req = store.put(record)
    req.onsuccess = () => resolve()
    req.onerror = (e) => reject(e.target.error)
  })
}

function dbDelete(db, localId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    const req = store.delete(localId)
    req.onsuccess = () => resolve()
    req.onerror = (e) => reject(e.target.error)
  })
}

/** Returns all pending items sorted FIFO by startedAt */
async function getPendingItems(db) {
  const items = await dbGetAll(db, "byStatus", "pending")
  return items.sort((a, b) => a.startedAt - b.startedAt)
}

// ---------------------------------------------------------------------------
// Broadcast helpers — notify open tabs of queue changes
// ---------------------------------------------------------------------------
async function broadcastQueueUpdate() {
  const db = await openDB()
  const pending = await dbGetAll(db, "byStatus", "pending")
  const failed = await dbGetAll(db, "byStatus", "failed")
  const clients = await self.clients.matchAll({ type: "window" })
  const msg = {
    type: "SYNC_QUEUE_UPDATE",
    pendingCount: pending.length,
    failedCount: failed.length,
  }
  clients.forEach((c) => c.postMessage(msg))
}

// ---------------------------------------------------------------------------
// Sync replay: drain pending queue FIFO
// ---------------------------------------------------------------------------
async function replayQueue() {
  const db = await openDB()
  const pending = await getPendingItems(db)

  for (const item of pending) {
    try {
      const response = await fetch("/api/offline-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      })

      if (response.ok) {
        await dbDelete(db, item.localId)
      } else {
        const updated = {
          ...item,
          status: item.retryCount >= 4 ? "failed" : "pending",
          retryCount: item.retryCount + 1,
          lastError: `HTTP ${response.status}`,
        }
        await dbPut(db, updated)
      }
    } catch {
      const updated = {
        ...item,
        retryCount: item.retryCount + 1,
        lastError: "network error",
      }
      await dbPut(db, updated)
    }
  }

  await broadcastQueueUpdate()
}

// ---------------------------------------------------------------------------
// Background Sync registration
// ---------------------------------------------------------------------------
self.addEventListener("sync", (event) => {
  if (event.tag === "rink-offline-queue") {
    event.waitUntil(replayQueue())
  }
})

// ---------------------------------------------------------------------------
// Message handler — UI → SW commands
// ---------------------------------------------------------------------------
self.addEventListener("message", (event) => {
  if (!event.data) return

  switch (event.data.type) {
    case "ENQUEUE_SUBMISSION": {
      openDB().then(async (db) => {
        const record = {
          localId: event.data.localId,
          moduleKey: event.data.moduleKey,
          action: event.data.action ?? "submit",
          payload: event.data.payload,
          startedAt: event.data.startedAt ?? Date.now(),
          status: "pending",
          retryCount: 0,
          lastError: null,
        }
        await dbPut(db, record)
        await broadcastQueueUpdate()
        // Try immediate sync if online
        if (self.registration.sync) {
          self.registration.sync.register("rink-offline-queue").catch(() => {})
        } else {
          replayQueue().catch(() => {})
        }
      })
      break
    }

    case "RETRY_FAILED": {
      openDB().then(async (db) => {
        const failed = await dbGetAll(db, "byStatus", "failed")
        for (const item of failed) {
          await dbPut(db, { ...item, status: "pending", retryCount: 0, lastError: null })
        }
        await broadcastQueueUpdate()
        if (self.registration.sync) {
          self.registration.sync.register("rink-offline-queue").catch(() => {})
        } else {
          replayQueue().catch(() => {})
        }
      })
      break
    }

    case "GET_QUEUE": {
      openDB().then(async (db) => {
        const pending = await dbGetAll(db, "byStatus", "pending")
        const failed = await dbGetAll(db, "byStatus", "failed")
        event.source?.postMessage({
          type: "SYNC_QUEUE_UPDATE",
          pendingCount: pending.length,
          failedCount: failed.length,
          items: [...pending, ...failed].sort((a, b) => a.startedAt - b.startedAt),
        })
      })
      break
    }

    default:
      break
  }
})

// ---------------------------------------------------------------------------
// Fetch handler
// ---------------------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return

  const url = new URL(event.request.url)

  // Always skip Supabase and external origins
  if (url.hostname !== self.location.hostname) return

  // Skip Next.js internals (HMR, etc.)
  if (url.pathname.startsWith("/_next/data/")) return

  // Static assets: cache-first
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached
        return fetch(event.request).then((res) => {
          const clone = res.clone()
          caches.open(STATIC_CACHE).then((c) => c.put(event.request, clone))
          return res
        })
      })
    )
    return
  }

  // Navigation requests: network-first, cache fallback
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone()
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone))
          return res
        })
        .catch(() => caches.match(event.request))
    )
    return
  }
})

// ---------------------------------------------------------------------------
// Online event: trigger replay (for browsers without Background Sync API)
// ---------------------------------------------------------------------------
self.addEventListener("online", () => {
  replayQueue().catch(() => {})
})
