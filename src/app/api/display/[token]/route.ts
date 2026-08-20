import { createHash } from "node:crypto"

import { NextResponse } from "next/server"

import { logServerError } from "@/lib/observability/log-server-error"
import {
  consumeRateLimit,
  displayRateLimitKey,
  type RateLimitStore,
} from "@/lib/rink-scheduling/display-rate-limit"
import {
  buildDisplayBoard,
  isPlausibleDisplayToken,
  readDisplaySettings,
  type DisplayAssignmentRow,
  type DisplayRoomRow,
} from "@/lib/rink-scheduling/locker-display"
import { createAdminClient } from "@/lib/supabase/admin"

// ---------------------------------------------------------------------------
// Public locker-room display feed.
//
// THE ONE UNAUTHENTICATED ENDPOINT IN THIS MODULE, and the reason it is a
// Route Handler rather than a server action: a TV browser polls it directly
// over plain HTTP with no session, which is exactly the "raw HTTP endpoint is
// genuinely required" case.
//
// WHY SERVICE ROLE AND NOT A SECURITY DEFINER FUNCTION. The caller is `anon`,
// so the alternatives were (a) grant anon SELECT on the locker/booking tables
// behind a token-checking policy, or (b) add a SECURITY DEFINER function
// callable by anon. Both widen the database's own surface permanently. Reading
// with the service-role key inside a handler that has already validated the
// token keeps `anon` with zero grants on every Module 12 table — the RLS
// migration asserts exactly that — and confines the trust to this file, where
// the response is assembled field by field.
//
// WHAT LEAVES THIS FILE. Only what buildDisplayBoard emits: room name, short
// code, a team label, a window, and the rink's name/colour. No customer, no
// contact detail, no rate, no invoice, no internal note, no id that addresses
// anything else. The board hangs where the public can photograph it.
// ---------------------------------------------------------------------------

export const runtime = "nodejs"
// The board is time-sensitive by definition; a cached response would show a
// stale room as occupied.
export const dynamic = "force-dynamic"

// Per-instance, best-effort. See the note in display-rate-limit.ts on why this
// is not a shared store.
const rateStore: RateLimitStore = new Map()

// A conforming TV polls at most once per 15s (the floor on refresh_seconds).
// 40/minute leaves generous headroom for a page that also refetches on focus,
// while stopping a scraper from turning one token into unbounded load.
const LIMIT_PER_MINUTE = 40
const WINDOW_MS = 60_000

// A separate, tighter budget for well-formed tokens that match nothing. This
// is the guessing bucket: legitimate displays never land in it.
const UNKNOWN_TOKEN_KEY = "unknown-token"
const UNKNOWN_LIMIT_PER_MINUTE = 10

// last_seen_at exists so an admin can tell a live TV from a forgotten one. It
// does not need per-poll precision, and writing on every poll would turn a
// read endpoint into a write endpoint.
const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60_000

/** Deliberately identical for "malformed", "unknown", "revoked" and
 *  "inactive": distinguishing them would confirm which guesses were close. */
function notFound() {
  return NextResponse.json({ error: "Display not found." }, { status: 404 })
}

function tooMany(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many requests." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  )
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params

    // Shape check before anything costs a query.
    if (!isPlausibleDisplayToken(token)) {
      const decision = consumeRateLimit(rateStore, UNKNOWN_TOKEN_KEY, Date.now(), {
        limit: UNKNOWN_LIMIT_PER_MINUTE,
        windowMs: WINDOW_MS,
      })
      if (!decision.allowed) return tooMany(decision.retryAfterSeconds)
      return notFound()
    }

    const tokenHash = createHash("sha256").update(token).digest("hex")

    const nowMs = Date.now()
    const decision = consumeRateLimit(rateStore, displayRateLimitKey(tokenHash), nowMs, {
      limit: LIMIT_PER_MINUTE,
      windowMs: WINDOW_MS,
    })
    if (!decision.allowed) return tooMany(decision.retryAfterSeconds)

    const admin = createAdminClient()

    const { data: tokenRow, error: tokenError } = await admin
      .from("rink_display_tokens")
      .select("id, facility_id, label, display_type, settings, is_active, revoked_at, last_seen_at")
      .eq("token_hash", tokenHash)
      .maybeSingle()
    if (tokenError) {
      logServerError("api/display", tokenError)
      return NextResponse.json({ error: "Display unavailable." }, { status: 503 })
    }
    if (!tokenRow || !tokenRow.is_active || tokenRow.revoked_at) {
      const unknown = consumeRateLimit(rateStore, UNKNOWN_TOKEN_KEY, nowMs, {
        limit: UNKNOWN_LIMIT_PER_MINUTE,
        windowMs: WINDOW_MS,
      })
      if (!unknown.allowed) return tooMany(unknown.retryAfterSeconds)
      return notFound()
    }
    if (tokenRow.display_type !== "locker_rooms") {
      // A display type this build does not know how to render.
      return notFound()
    }

    const facilityId = tokenRow.facility_id

    // Read the zone with the admin client rather than getFacilityTimezone(),
    // which is typed against the cookie-bound server client.
    const [{ data: settingsRow }, { data: facilityRow }] = await Promise.all([
      admin
        .from("rink_scheduling_settings")
        .select("display_refresh_seconds")
        .eq("facility_id", facilityId)
        .maybeSingle(),
      admin.from("facilities").select("timezone").eq("id", facilityId).maybeSingle(),
    ])
    const timeZone = facilityRow?.timezone ?? null

    const { hoursAhead, refreshSeconds } = readDisplaySettings(
      tokenRow.settings,
      settingsRow?.display_refresh_seconds ?? 60,
    )

    const horizonIso = new Date(nowMs + hoursAhead * 60 * 60_000).toISOString()
    const nowIso = new Date(nowMs).toISOString()

    const [{ data: roomRows }, { data: assignmentRows }] = await Promise.all([
      admin
        .from("facility_locker_rooms")
        .select("id, name, short_code, sort_order")
        .eq("facility_id", facilityId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      admin
        .from("rink_locker_room_assignments")
        .select(
          `id, locker_room_id, occupies_from, occupies_until, display_label_override,
           rink_bookings!inner ( title, status, facility_rinks ( name, display_color ) )`,
        )
        .eq("facility_id", facilityId)
        .gt("occupies_until", nowIso)
        .lt("occupies_from", horizonIso),
    ])

    const rooms: DisplayRoomRow[] = (roomRows ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      shortCode: r.short_code,
      sortOrder: r.sort_order,
    }))

    const roomById = new Map(rooms.map((r) => [r.id, r]))

    const assignments: DisplayAssignmentRow[] = []
    for (const row of assignmentRows ?? []) {
      const booking = row.rink_bookings
      // A cancelled booking releases its rooms from the board immediately.
      if (!booking || booking.status === "cancelled") continue
      const room = roomById.get(row.locker_room_id)
      if (!room) continue
      const rink = booking.facility_rinks

      assignments.push({
        assignmentId: row.id,
        lockerRoomId: row.locker_room_id,
        lockerRoomName: room.name,
        lockerRoomShortCode: room.shortCode,
        sortOrder: room.sortOrder,
        occupiesFrom: row.occupies_from,
        occupiesUntil: row.occupies_until,
        // Override first, then the booking's own title, then a neutral word.
        // Never the customer record: the display is public.
        label: (row.display_label_override ?? booking.title ?? "").trim() || "Reserved",
        rinkName: rink?.name ?? null,
        rinkColor: rink?.display_color ?? null,
      })
    }

    const board = buildDisplayBoard(rooms, assignments, nowMs, hoursAhead, timeZone)

    void touchLastSeen(admin, tokenRow.id, tokenRow.last_seen_at, nowMs)

    return NextResponse.json(
      {
        label: tokenRow.label,
        refreshSeconds,
        timeZone,
        ...board,
      },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (e) {
    logServerError("api/display", e)
    return NextResponse.json({ error: "Display unavailable." }, { status: 503 })
  }
}

/**
 * Stamp last_seen_at at most every LAST_SEEN_WRITE_INTERVAL_MS.
 *
 * Fire-and-forget: a TV that cannot record its heartbeat should still show the
 * board, so a failure here is swallowed rather than surfaced.
 */
async function touchLastSeen(
  admin: ReturnType<typeof createAdminClient>,
  tokenId: string,
  lastSeenAt: string | null,
  nowMs: number,
): Promise<void> {
  try {
    const previous = lastSeenAt ? Date.parse(lastSeenAt) : Number.NaN
    if (Number.isFinite(previous) && nowMs - previous < LAST_SEEN_WRITE_INTERVAL_MS) return
    await admin
      .from("rink_display_tokens")
      .update({ last_seen_at: new Date(nowMs).toISOString() })
      .eq("id", tokenId)
  } catch {
    // Intentionally silent.
  }
}
