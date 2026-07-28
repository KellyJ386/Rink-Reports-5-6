// Opaque replay-failure response for the offline-sync endpoint and its
// per-module handlers. Raw claim/persist errors can echo DB internals
// (constraint/column names), so the client body stays generic — but every
// failure mints a short correlation ref that is logged with the server-side
// detail AND appended to the client message, so a Pending Sync Queue
// screenshot ("ref: a1b2c3d4") can be joined to the matching [server-error]
// log line without leaking schema text.

import "server-only"

import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"

import { logServerError } from "@/lib/observability/log-server-error"

/**
 * Log the raw error server-side (tagged with a fresh 8-char ref) and return
 * the opaque body carrying the same ref. Status is always 500 — the service
 * worker classifies retryable-vs-permanent on status alone and reads `error`
 * only as a display string (see classifyReplayResult in public/sw.js), so the
 * ref suffix is presentation-only.
 */
export function opaqueReplayFailure(
  context: string,
  err: unknown,
  extra?: Record<string, string | number | boolean | null>,
): NextResponse {
  const ref = randomUUID().slice(0, 8)
  logServerError(context, err, { ...extra, ref })
  return NextResponse.json(
    { error: `Failed to save the submission. (ref: ${ref})` },
    { status: 500 }
  )
}
