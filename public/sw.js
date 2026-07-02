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

// CACHE_NAME bumped to v5 when the /offline-schedule data-free shell gained a
// network-first cache entry, so any client on an older SW re-evaluates and
// cleans its caches on activate, guaranteeing a clean swap to the new strategy.
const CACHE_NAME = "rink-reports-v5"
const STATIC_CACHE = "rink-reports-static-v5"
const DB_NAME = "rink-offline-queue"
const DB_VERSION = 1
const STORE_NAME = "submissions"

// ---------------------------------------------------------------------------
// Replay retry policy — INLINE MIRROR of src/lib/offline/retry-policy.ts
// (a classic SW can't import ES modules). Keep the two in sync; the .ts copy
// is unit-tested. See retry-policy.test.ts.
// ---------------------------------------------------------------------------
const MAX_REPLAY_RETRIES = 4
const RETRY_BACKOFF_MS = [5000, 15000, 60000, 300000]
const TRANSIENT_4XX = new Set([401, 408, 409, 425, 429])

function isTransientReplayStatus(status) {
  if (status === null) return true
  if (status >= 500) return true
  if (status >= 400) return TRANSIENT_4XX.has(status)
  return false
}

/** Mirror of classifyReplayResult() in retry-policy.ts. */
function classifyReplayResult(ok, status, retryCount, now) {
  if (ok) return { kind: "success" }
  if (!isTransientReplayStatus(status)) {
    return { kind: "failed", retryCount: retryCount + 1, permanent: true }
  }
  const nextCount = retryCount + 1
  if (nextCount > MAX_REPLAY_RETRIES) {
    return { kind: "failed", retryCount: nextCount, permanent: false }
  }
  const delayMs = RETRY_BACKOFF_MS[Math.min(nextCount - 1, RETRY_BACKOFF_MS.length - 1)]
  return { kind: "retry", retryCount: nextCount, nextAttemptAt: now + delayMs, delayMs }
}

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
      // Best-effort persistent-storage grant so the browser is less likely to
      // evict the IndexedDB queue under storage pressure (E-09). Guarded: not
      // all engines expose navigator.storage.persist.
      .then(() => requestPersistentStorage())
      // A freshly-activated SW (relaunch / update-apply) should drain anything
      // that was left pending — the fast path (Background Sync) may never fire
      // on Safari/iOS (E-02).
      .then(() => replayQueue().catch(() => {}))
  )
})

// Best-effort persistent-storage request (E-09). Never throws.
async function requestPersistentStorage() {
  try {
    if (self.navigator && self.navigator.storage && self.navigator.storage.persist) {
      await self.navigator.storage.persist()
    }
  } catch {
    // ignore — this is a best-effort hint only
  }
}

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

// Reschedule timer: when items are waiting out a backoff, re-run replay once
// the soonest one comes due (best-effort; the `online`/`sync` events and new
// enqueues also re-trigger). Module-level so we keep just one pending timer.
let retryTimer = null

// Pull the server's `{ error }` body (if any) for a human-readable lastError.
async function readErrorMessage(response) {
  try {
    const data = await response.json()
    if (data && typeof data.error === "string" && data.error.length > 0) {
      return data.error
    }
  } catch {
    // non-JSON body — fall through to the generic status text
  }
  return `HTTP ${response.status}`
}

// ---------------------------------------------------------------------------
// Sync replay: drain DUE pending items FIFO, with exponential backoff and
// permanent-vs-transient classification (see the retry policy above).
// ---------------------------------------------------------------------------
async function replayQueue() {
  const db = await openDB()
  const pending = await getPendingItems(db)
  const now = Date.now()

  for (const item of pending) {
    // Respect backoff: skip items not yet due for another attempt.
    if (item.nextAttemptAt && item.nextAttemptAt > now) continue

    const retryCount = item.retryCount ?? 0
    try {
      const response = await fetch("/api/offline-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      })

      const outcome = classifyReplayResult(
        response.ok,
        response.status,
        retryCount,
        Date.now(),
      )

      if (outcome.kind === "success") {
        await dbDelete(db, item.localId)
      } else if (outcome.kind === "retry") {
        await dbPut(db, {
          ...item,
          status: "pending",
          retryCount: outcome.retryCount,
          nextAttemptAt: outcome.nextAttemptAt,
          lastStatus: response.status,
          lastError: await readErrorMessage(response),
        })
      } else {
        // failed (permanent client error, or transient retries exhausted)
        await dbPut(db, {
          ...item,
          status: "failed",
          retryCount: outcome.retryCount,
          permanent: outcome.permanent,
          nextAttemptAt: null,
          lastStatus: response.status,
          lastError: await readErrorMessage(response),
        })
      }
    } catch {
      // fetch threw → network error mid-flight; always transient.
      const outcome = classifyReplayResult(false, null, retryCount, Date.now())
      if (outcome.kind === "retry") {
        await dbPut(db, {
          ...item,
          status: "pending",
          retryCount: outcome.retryCount,
          nextAttemptAt: outcome.nextAttemptAt,
          lastStatus: null,
          lastError: "Network unavailable",
        })
      } else {
        await dbPut(db, {
          ...item,
          status: "failed",
          retryCount: outcome.retryCount,
          permanent: false,
          nextAttemptAt: null,
          lastStatus: null,
          lastError: "Network unavailable",
        })
      }
    }
  }

  await broadcastQueueUpdate()
  await scheduleNextRetry(db)
}

// Schedule a single timer to re-run replay when the earliest backed-off item
// becomes due. No-op if nothing is waiting.
async function scheduleNextRetry(db) {
  const stillPending = await dbGetAll(db, "byStatus", "pending")
  const now = Date.now()
  let soonest = Infinity
  for (const item of stillPending) {
    const due = item.nextAttemptAt ?? now
    if (due > now && due < soonest) soonest = due
  }
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  if (soonest !== Infinity) {
    const delay = Math.max(0, soonest - now)
    retryTimer = setTimeout(() => {
      retryTimer = null
      replayQueue().catch(() => {})
    }, delay)
  }
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
          // Owner = the auth uid signed in when this was queued. Carried through
          // to the replay POST so the server rejects (never re-attributes) a
          // flush under a different session on a shared kiosk (E-01).
          ownerId: event.data.ownerId ?? null,
          startedAt: event.data.startedAt ?? Date.now(),
          status: "pending",
          retryCount: 0,
          nextAttemptAt: 0,
          lastStatus: null,
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
          await dbPut(db, {
            ...item,
            status: "pending",
            retryCount: 0,
            nextAttemptAt: 0,
            permanent: false,
            lastStatus: null,
            lastError: null,
          })
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

    case "FLUSH_QUEUE": {
      // Drain EVERYTHING queued now — both pending and (non-permanent) failed
      // items — reset for an immediate attempt. This is the reliable flush the
      // client fires on reconnect/foreground for browsers without Background
      // Sync, where nothing else survives SW termination (E-02). Items that
      // failed *permanently* (4xx/422) are left alone; only the explicit
      // "Retry failed" action re-drives those.
      openDB().then(async (db) => {
        const failed = await dbGetAll(db, "byStatus", "failed")
        for (const item of failed) {
          if (item.permanent) continue
          await dbPut(db, {
            ...item,
            status: "pending",
            retryCount: 0,
            nextAttemptAt: 0,
            lastStatus: null,
            lastError: null,
          })
        }
        await replayQueue().catch(() => {})
      })
      break
    }

    case "QUARANTINE_FOREIGN": {
      // A different user signed in (or signed out) on this device. Park any
      // queued item that belongs to another owner as a permanent failure so it
      // is NEVER replayed under the new session — mirrors the schedule-cache
      // hygiene AuthStateListener already applies (E-01). `currentOwnerId` may
      // be null on sign-out, which quarantines everything with a known owner.
      const currentOwnerId = event.data.currentOwnerId ?? null
      openDB().then(async (db) => {
        const pending = await dbGetAll(db, "byStatus", "pending")
        const failed = await dbGetAll(db, "byStatus", "failed")
        for (const item of [...pending, ...failed]) {
          if (item.ownerId && item.ownerId !== currentOwnerId) {
            await dbPut(db, {
              ...item,
              status: "failed",
              permanent: true,
              nextAttemptAt: null,
              lastStatus: null,
              lastError:
                "Queued by a different user — sign in as that user to sync.",
            })
          }
        }
        await broadcastQueueUpdate()
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

  // Exception: the dedicated /offline-schedule shell is DATA-FREE (it renders
  // no user data server-side; shifts come from the per-user IndexedDB cache),
  // so it is safe to cache for offline navigation on a shared device — unlike
  // every other authenticated page. Network-first: refresh the shell when
  // online, fall back to the cached shell when offline.
  if (event.request.mode === "navigate" && url.pathname === "/offline-schedule") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res && res.ok && !res.redirected) {
            const clone = res.clone()
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone))
          }
          return res
        })
        .catch(() =>
          caches
            .match(event.request, { ignoreSearch: true })
            .then((cached) => cached || offlineFallbackResponse())
        )
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
