"use client"

// Tracks the auth uid of the user who is currently signed in on this device, so
// that offline submissions can be STAMPED with their owner at enqueue time
// (E-01). The offline queue lives in origin-global IndexedDB; without an owner
// stamp, user A's queued report would replay under whoever's session is live at
// flush time on a shared kiosk. `AuthStateListener` keeps this in sync with the
// Supabase auth state; `enqueueSubmission` reads it synchronously so form submit
// handlers stay non-async.
//
// The value is MIRRORED into localStorage so it also resolves synchronously on
// the next page load (R-2). Without that mirror the id only exists once the
// async `getSession()` in AuthStateListener resolves — and that call reports no
// session once the access token has expired and the refresh can't reach the
// network, i.e. exactly the state of a driver who has been working offline for
// over an hour. An unseeded owner makes `enqueueSubmission` refuse the
// submission, so falling back to the last KNOWN owner is both safer and more
// accurate: it is only ever cleared on a real sign-out, or replaced when a
// different user signs in. The uid is not a secret — the page already renders
// that user's own data.

const STORAGE_KEY = "rr-offline-owner"

let currentOwnerId: string | null = null
let hydrated = false

/** Set the owner uid for subsequently-enqueued offline submissions. */
export function setCurrentOwnerId(userId: string | null) {
  currentOwnerId = userId
  hydrated = true
  try {
    if (userId) window.localStorage.setItem(STORAGE_KEY, userId)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage disabled / private mode — the in-memory value still covers this
    // page load.
  }
}

/** The auth uid to stamp on a submission enqueued right now (may be null). */
export function getCurrentOwnerId(): string | null {
  if (!hydrated) {
    hydrated = true
    try {
      currentOwnerId = window.localStorage.getItem(STORAGE_KEY)
    } catch {
      currentOwnerId = null
    }
  }
  return currentOwnerId
}
