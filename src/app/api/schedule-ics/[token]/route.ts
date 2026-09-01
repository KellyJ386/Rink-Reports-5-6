import { NextResponse } from "next/server"

import { buildIcsCalendar, type IcsEvent } from "@/lib/ics"
import { logServerError } from "@/lib/observability/log-server-error"
import {
  consumeRateLimit,
  type RateLimitStore,
} from "@/lib/rink-scheduling/display-rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// Calendar apps poll every few minutes to hours; 20/minute is far beyond any
// conforming client while capping scraper throughput on a leaked URL. A wrong
// token is bounded separately and more tightly so the feed can't be used as a
// token-guessing oracle. Best-effort in-process cap (per instance), matching
// /api/rink-ics — the security boundary remains the >=32-char token itself.
const LIMIT_PER_MINUTE = 20
const WINDOW_MS = 60_000
const UNKNOWN_TOKEN_KEY = "unknown-token"
const UNKNOWN_LIMIT_PER_MINUTE = 10
const rateStore: RateLimitStore = new Map()

/**
 * Public ICS calendar feed: Google/Apple Calendar subscribe to
 * /api/schedule-ics/<token> and poll it — calendar apps cannot carry an
 * authenticated session, so the unguessable per-employee token (owner-only
 * schedule_ics_tokens, migration 168) IS the credential. Reads with the
 * service role; scope is strictly the token owner's PUBLISHED shifts in a
 * -7d…+60d window. Rotating the token (staff "Reset link") 404s old URLs.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  // Tokens are ≥32 chars of URL-safe material; reject junk before any query.
  if (!token || token.length < 32 || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  let admin
  try {
    admin = createAdminClient()
  } catch (e) {
    logServerError("api/schedule-ics", e)
    return NextResponse.json({ error: "not configured" }, { status: 503 })
  }

  try {
    const nowMs = Date.now()
    const { data: tokenRow } = await admin
      .from("schedule_ics_tokens")
      .select("employee_id, facility_id")
      .eq("token", token)
      .maybeSingle<{ employee_id: string; facility_id: string }>()
    if (!tokenRow) {
      // Bound token-guessing with a tight, shared unknown-token budget before
      // returning the same 404 a junk token gets.
      const unknown = consumeRateLimit(rateStore, UNKNOWN_TOKEN_KEY, nowMs, {
        limit: UNKNOWN_LIMIT_PER_MINUTE,
        windowMs: WINDOW_MS,
      })
      if (!unknown.allowed) {
        return NextResponse.json(
          { error: "too many requests" },
          { status: 429, headers: { "Retry-After": String(unknown.retryAfterSeconds) } }
        )
      }
      return NextResponse.json({ error: "not found" }, { status: 404 })
    }

    // A resolved token gets its own, more generous per-token budget: a real
    // calendar client polls far below this; a leaked URL being scraped is not.
    const decision = consumeRateLimit(rateStore, `sched:${token}`, nowMs, {
      limit: LIMIT_PER_MINUTE,
      windowMs: WINDOW_MS,
    })
    if (!decision.allowed) {
      return NextResponse.json(
        { error: "too many requests" },
        { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } }
      )
    }

    const now = new Date()
    const windowStart = new Date(now.getTime() - 7 * 24 * 3_600_000)
    const windowEnd = new Date(now.getTime() + 60 * 24 * 3_600_000)

    const [{ data: facility }, { data: shiftsRaw }, { data: jobAreasRaw }] =
      await Promise.all([
        admin
          .from("facilities")
          .select("name")
          .eq("id", tokenRow.facility_id)
          .maybeSingle<{ name: string }>(),
        admin
          .from("schedule_shifts")
          .select("id, starts_at, ends_at, job_area_id, role_label, notes")
          .eq("facility_id", tokenRow.facility_id)
          .eq("employee_id", tokenRow.employee_id)
          .eq("status", "published")
          .gte("starts_at", windowStart.toISOString())
          .lt("starts_at", windowEnd.toISOString())
          .order("starts_at", { ascending: true })
          .limit(500),
        admin
          .from("employee_job_areas")
          .select("id, name")
          .eq("facility_id", tokenRow.facility_id),
      ])

    const jobAreaNameById = new Map(
      ((jobAreasRaw ?? []) as { id: string; name: string }[]).map((j) => [
        j.id,
        j.name,
      ])
    )
    const facilityName = facility?.name ?? "Rink Reports"

    const events: IcsEvent[] = (
      (shiftsRaw ?? []) as {
        id: string
        starts_at: string
        ends_at: string
        job_area_id: string | null
        role_label: string | null
        notes: string | null
      }[]
    ).map((s) => {
      const area = s.job_area_id ? jobAreaNameById.get(s.job_area_id) : null
      const what = area ?? s.role_label ?? "Shift"
      return {
        uid: `${s.id}@rink-reports`,
        start: new Date(s.starts_at),
        end: new Date(s.ends_at),
        summary: area || s.role_label ? `Shift — ${what}` : "Shift",
        description: s.notes ?? undefined,
        location: facilityName,
      }
    })

    const ics = buildIcsCalendar({
      calendarName: `${facilityName} — My Shifts`,
      events,
    })

    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="schedule.ics"',
        // Calendar apps poll; a short private cache keeps load sane without
        // making schedule changes feel stale.
        "Cache-Control": "private, max-age=300",
      },
    })
  } catch (e) {
    logServerError("api/schedule-ics", e)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  }
}
