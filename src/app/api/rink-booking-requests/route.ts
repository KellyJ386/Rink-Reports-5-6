import { NextResponse } from "next/server"

import { logServerError } from "@/lib/observability/log-server-error"
import { validateBookingRequest } from "@/lib/rink-scheduling/booking-request"
import {
  consumeRateLimit,
  displayRateLimitKey,
  type RateLimitStore,
} from "@/lib/rink-scheduling/display-rate-limit"
import { resolvePublicToken, touchTokenLastSeen } from "@/lib/rink-scheduling/public-tokens"
import { createAdminClient } from "@/lib/supabase/admin"
import { dayKeyInTz } from "@/lib/timezone"

// ---------------------------------------------------------------------------
// Public booking-request intake.
//
// The write path for /request-ice/<token>. Same trust model as the display
// endpoint: the unguessable request_form token IS the credential, anon holds
// ZERO grants on rink_booking_requests, and the insert happens with the
// service role only after the token has been validated and the payload has
// passed the shared pure validator. What can land in the table is exactly a
// 'new'-status request shaped by validateBookingRequest — nothing else.
// ---------------------------------------------------------------------------

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const rateStore: RateLimitStore = new Map()

// A human fills this form in minutes; 5/minute per token absorbs a family
// booking several slots while stopping bulk spam through a leaked link.
const LIMIT_PER_MINUTE = 5
const WINDOW_MS = 60_000
const UNKNOWN_TOKEN_KEY = "unknown-token"
const UNKNOWN_LIMIT_PER_MINUTE = 10

/** Indistinguishable for malformed, unknown, revoked and wrong-type tokens. */
function notFound() {
  return NextResponse.json({ ok: false, error: "This request link is no longer active." }, { status: 404 })
}

export async function POST(request: Request) {
  try {
    let body: Record<string, unknown>
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 })
    }

    const nowMs = Date.now()
    const admin = createAdminClient()

    const token = await resolvePublicToken(admin, body.token, "request_form")
    if (!token) {
      const unknown = consumeRateLimit(rateStore, UNKNOWN_TOKEN_KEY, nowMs, {
        limit: UNKNOWN_LIMIT_PER_MINUTE,
        windowMs: WINDOW_MS,
      })
      if (!unknown.allowed) {
        return NextResponse.json(
          { ok: false, error: "Too many requests." },
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
        { ok: false, error: "Too many requests — try again in a minute." },
        { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } },
      )
    }

    const { data: facility } = await admin
      .from("facilities")
      .select("timezone")
      .eq("id", token.facilityId)
      .maybeSingle()
    const todayKey = dayKeyInTz(new Date(nowMs), facility?.timezone ?? null)

    const validated = validateBookingRequest(body, todayKey)
    if (!validated.ok) {
      return NextResponse.json({ ok: false, error: validated.error }, { status: 422 })
    }
    const value = validated.value

    // A rink id is only accepted if it names one of THIS facility's rinks —
    // a stale or foreign id degrades to "any rink" rather than an error the
    // requester cannot act on.
    let rinkId: string | null = null
    if (value.rinkId) {
      const { data: rink } = await admin
        .from("facility_rinks")
        .select("id")
        .eq("id", value.rinkId)
        .eq("facility_id", token.facilityId)
        .maybeSingle()
      rinkId = rink?.id ?? null
    }

    const { error } = await admin.from("rink_booking_requests").insert({
      facility_id: token.facilityId,
      requester_name: value.requesterName,
      requester_email: value.requesterEmail,
      requester_phone: value.requesterPhone,
      organization: value.organization,
      rink_id: rinkId,
      requested_date: value.requestedDate,
      start_minute: value.startMinute,
      end_minute: value.endMinute,
      purpose: value.purpose,
      status: "new",
    })
    if (error) {
      logServerError("api/rink-booking-requests", error)
      return NextResponse.json(
        { ok: false, error: "Could not save your request. Try again." },
        { status: 500 },
      )
    }

    void touchTokenLastSeen(admin, token, nowMs)
    return NextResponse.json({ ok: true })
  } catch (e) {
    logServerError("api/rink-booking-requests", e)
    return NextResponse.json(
      { ok: false, error: "Could not save your request. Try again." },
      { status: 500 },
    )
  }
}
