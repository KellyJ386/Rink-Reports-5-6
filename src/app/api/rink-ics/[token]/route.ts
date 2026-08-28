import { NextResponse } from "next/server"

import { buildIcsCalendar, type IcsEvent } from "@/lib/ics"
import { logServerError } from "@/lib/observability/log-server-error"
import {
  consumeRateLimit,
  displayRateLimitKey,
  type RateLimitStore,
} from "@/lib/rink-scheduling/display-rate-limit"
import { publicSlotLabel } from "@/lib/rink-scheduling/ice-schedule-display"
import { resolvePublicToken, touchTokenLastSeen } from "@/lib/rink-scheduling/public-tokens"
import { createAdminClient } from "@/lib/supabase/admin"

// ---------------------------------------------------------------------------
// Public rink-schedule ICS feed: coaches and league schedulers subscribe
// their calendar app to /api/rink-ics/<token>. Calendar apps cannot carry a
// session, so the unguessable rink_ics token IS the credential — same model
// as the employee schedule feed (migration 168) but with the hashed-token
// storage this module already uses for displays.
//
// WHAT LEAVES THIS FILE: the public label (booking title, else type, else
// "Reserved"), the window, and the rink name. No customer, no rate, no note.
// ---------------------------------------------------------------------------

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const rateStore: RateLimitStore = new Map()

// Calendar apps poll every few minutes to hours; 20/minute is far beyond any
// conforming client while capping scraper throughput on a leaked URL.
const LIMIT_PER_MINUTE = 20
const WINDOW_MS = 60_000
const UNKNOWN_TOKEN_KEY = "unknown-token"
const UNKNOWN_LIMIT_PER_MINUTE = 10

function notFound() {
  return NextResponse.json({ error: "not found" }, { status: 404 })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token: rawToken } = await params
    const nowMs = Date.now()
    const admin = createAdminClient()

    const token = await resolvePublicToken(admin, rawToken, "rink_ics")
    if (!token) {
      const unknown = consumeRateLimit(rateStore, UNKNOWN_TOKEN_KEY, nowMs, {
        limit: UNKNOWN_LIMIT_PER_MINUTE,
        windowMs: WINDOW_MS,
      })
      if (!unknown.allowed) {
        return NextResponse.json(
          { error: "too many requests" },
          { status: 429, headers: { "Retry-After": String(unknown.retryAfterSeconds) } },
        )
      }
      return notFound()
    }

    const decision = consumeRateLimit(rateStore, displayRateLimitKey(token.id), nowMs, {
      limit: LIMIT_PER_MINUTE,
      windowMs: WINDOW_MS,
    })
    if (!decision.allowed) {
      return NextResponse.json(
        { error: "too many requests" },
        { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } },
      )
    }

    const windowStart = new Date(nowMs - 7 * 24 * 3_600_000)
    const windowEnd = new Date(nowMs + 60 * 24 * 3_600_000)

    const [{ data: facility }, { data: rinks }, { data: types }, { data: bookings }] =
      await Promise.all([
        admin.from("facilities").select("name").eq("id", token.facilityId).maybeSingle(),
        admin
          .from("facility_rinks")
          .select("id, name")
          .eq("facility_id", token.facilityId),
        admin
          .from("rink_booking_types")
          .select("id, name")
          .eq("facility_id", token.facilityId),
        admin
          .from("rink_bookings")
          .select("id, rink_id, booking_type_id, title, starts_at, ends_at, status")
          .eq("facility_id", token.facilityId)
          .neq("status", "cancelled")
          .gte("starts_at", windowStart.toISOString())
          .lt("starts_at", windowEnd.toISOString())
          .order("starts_at", { ascending: true })
          .limit(1000),
      ])

    const facilityName = facility?.name ?? "Rink"
    const rinkNameById = new Map((rinks ?? []).map((r) => [r.id, r.name]))
    const typeNameById = new Map((types ?? []).map((t) => [t.id, t.name]))

    const events: IcsEvent[] = (bookings ?? []).map((b) => {
      const label = publicSlotLabel(b.title, typeNameById.get(b.booking_type_id) ?? null)
      const rinkName = rinkNameById.get(b.rink_id)
      return {
        uid: `${b.id}@rink-reports`,
        start: new Date(b.starts_at),
        end: new Date(b.ends_at),
        summary: rinkName ? `${label} — ${rinkName}` : label,
        location: rinkName ? `${rinkName}, ${facilityName}` : facilityName,
      }
    })

    const ics = buildIcsCalendar({
      calendarName: `${facilityName} — Ice Schedule`,
      events,
    })

    void touchTokenLastSeen(admin, token, nowMs)

    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="ice-schedule.ics"',
        // Calendar apps poll; a short private cache keeps load sane without
        // making schedule changes feel stale.
        "Cache-Control": "private, max-age=300",
      },
    })
  } catch (e) {
    logServerError("api/rink-ics", e)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  }
}
