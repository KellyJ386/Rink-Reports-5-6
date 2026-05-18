// =============================================================================
// Rink Reports — Service Worker
//
// Strategy:
//  - Navigation requests: network-only. When the network fails we return a
//    synthetic "You're offline" page rather than serving a cached response.
//    Caching authenticated HTML in a shared SW cache risks cross-user leak on
//    shared kiosks (user B sees user A's previously rendered admin pages).
//    The PWA's offline value is the IndexedDB submission queue below, not
//    offline page browsing.
//  - Static assets (_next/static): cache-first. Content-hashed by Next so
//    they're safe to share across users.
//  - Module form submissions (POST to /api/offline-sync): queued in IndexedDB
//    when offline, replayed FIFO (by startedAt) when online.
//  - Supabase API calls: always network-only (no cache).
// =============================================================================

// CACHE_NAME bumped to v3 so installs that previously cached authenticated
// HTML under v2 get their stale cache deleted on activate.
const CACHE_NAME = "rink-reports-v3"
const STATIC_CACHE = "rink-reports-static-v3"
const DB_NAME = "rink-offline-queue"
const DB_VERSION = 1
const STORE_NAME = "submissions"

// ---------------------------------------------------------------------------
// Install: do NOT call skipWaiting() here. A staff member mid-shift filling
// out a report shouldn't have the SW (and its IndexedDB queue) swapped from
// under them. The new SW stays in "waiting" until the page posts
// {type:"SKIP_WAITING"} — see the message handler and sw-register.tsx.
// ---------------------------------------------------------------------------
self.addEventListener("install", () => {
  // intentionally no-op
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
    case "SKIP_WAITING": {
      // Page is signalling that the user accepted the update prompt.
      self.skipWaiting()
      break
    }

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

  // Navigation requests: network-only. Authenticated HTML must NOT be cached
  // (see header comment). On network failure return a synthetic offline page
  // so the browser doesn't show its generic "no internet" UI.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => offlineFallbackResponse())
    )
    return
  }
})

function offlineFallbackResponse() {
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Offline — Rink Reports</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background:#0f172a; color:#e2e8f0;
         min-height:100vh; margin:0; display:flex; align-items:center; justify-content:center;
         padding:1.5rem; }
  main { max-width:24rem; text-align:center; }
  h1 { font-size:1.25rem; margin:0 0 0.5rem; }
  p { font-size:0.9rem; color:#94a3b8; margin:0 0 1.25rem; line-height:1.5; }
  button { background:#3b82f6; color:#fff; border:0; padding:0.6rem 1.1rem; border-radius:0.375rem;
           font-size:0.9rem; cursor:pointer; }
</style>
</head>
<body>
<main>
  <h1>You're offline</h1>
  <p>Any reports you submit while offline are saved locally and will sync automatically once you're back online.</p>
  <button onclick="location.reload()">Try again</button>
</main>
</body>
</html>`
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
}

// ---------------------------------------------------------------------------
// Online event: trigger replay (for browsers without Background Sync API)
// ---------------------------------------------------------------------------
self.addEventListener("online", () => {
  replayQueue().catch(() => {})
})
