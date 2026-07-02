"use client"

// Tracks the auth uid of the user who is currently signed in on this device, so
// that offline submissions can be STAMPED with their owner at enqueue time
// (E-01). The offline queue lives in origin-global IndexedDB; without an owner
// stamp, user A's queued report would replay under whoever's session is live at
// flush time on a shared kiosk. `AuthStateListener` keeps this in sync with the
// Supabase auth state; `enqueueSubmission` reads it synchronously so form submit
// handlers stay non-async.

let currentOwnerId: string | null = null

/** Set the owner uid for subsequently-enqueued offline submissions. */
export function setCurrentOwnerId(userId: string | null) {
  currentOwnerId = userId
}

/** The auth uid to stamp on a submission enqueued right now (may be null). */
export function getCurrentOwnerId(): string | null {
  return currentOwnerId
}
