import { NextRequest, NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

type RequestBody = {
  name?: string
  email?: string
  company?: string
  addressLine1?: string
  addressLine2?: string
  addressCity?: string
  addressRegion?: string
  addressPostal?: string
  addressCountry?: string
  note?: string
}

// Per-field caps mirror the CHECK constraints on public.information_requests
// (migration 88). Truncating here keeps the boundary clean so a long input is
// trimmed rather than rejected by the DB with an opaque 500.
const LIMITS = {
  name: 200,
  email: 320,
  company: 200,
  addressLine1: 200,
  addressLine2: 200,
  addressCity: 120,
  addressRegion: 120,
  addressPostal: 40,
  addressCountry: 120,
  note: 5000,
} as const
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return ""
  return value.trim().slice(0, max)
}

// IP-based rate limiting for this PUBLIC, unauthenticated endpoint. Postgres
// backs the counter (no Redis/KV in this stack) via the SECURITY DEFINER
// public.check_rate_limit() function added in migration 92.
const RATE_LIMIT_BUCKET = "information_requests"
const RATE_LIMIT_MAX = 5 // requests allowed per IP per window
const RATE_LIMIT_WINDOW_SECONDS = 600 // 10 minutes

// Derive the client IP from a TRUSTED source. This endpoint is public and
// unauthenticated, so the IP is the only rate-limit key — it must not be
// attacker-controlled.
//
// The naive `x-forwarded-for`.split(",")[0] (leftmost) is spoofable: a client
// can send its own XFF header and the platform APPENDS the real IP, so the
// leftmost entry is whatever the attacker chose — rotating it defeats the cap
// entirely. We instead prefer `x-real-ip` (set by the Vercel edge to the true
// client IP, overwriting any client value) and fall back to the RIGHTMOST XFF
// hop (the one added by our own trusted proxy), never the leftmost. A missing
// value collapses to a single shared bucket so it still rate-limits rather than
// bypassing the check.
function clientIp(request: NextRequest): string {
  const realIp = request.headers.get("x-real-ip")?.trim()
  if (realIp) return realIp

  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean)
    const last = hops[hops.length - 1]
    if (last) return last
  }
  return "unknown"
}

export async function POST(request: NextRequest) {
  let body: RequestBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const name = clean(body.name, LIMITS.name)
  const email = clean(body.email, LIMITS.email)
  const company = clean(body.company, LIMITS.company)
  const addressCountry = clean(body.addressCountry, LIMITS.addressCountry)

  if (!name || !email || !company || !addressCountry) {
    return NextResponse.json(
      { error: "Name, email, company, and country are required." },
      { status: 400 }
    )
  }

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 }
    )
  }

  const supabase = await createClient()

  // Rate-limit by client IP before touching the table. Fail CLOSED if the RPC
  // itself errors: this is a public, unauthenticated write, so an unbounded
  // insert path on a rate-limiter outage is worse than briefly turning away
  // legitimate leads (who can retry). Abuse protection must not depend on the
  // limiter being healthy.
  const ip = clientIp(request)
  const { data: allowed, error: rateError } = await supabase.rpc(
    "check_rate_limit",
    {
      p_bucket: RATE_LIMIT_BUCKET,
      p_identifier: ip,
      p_max: RATE_LIMIT_MAX,
      p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
    }
  )

  if (rateError) {
    console.error("information-requests: rate limit check failed", rateError)
    return NextResponse.json(
      { error: "Service temporarily unavailable. Please try again shortly." },
      {
        status: 503,
        headers: { "Retry-After": "30" },
      }
    )
  }
  if (allowed === false) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in a few minutes." },
      {
        status: 429,
        headers: { "Retry-After": String(RATE_LIMIT_WINDOW_SECONDS) },
      }
    )
  }

  // The `information_requests_insert` RLS policy is intentionally
  // `with check (true)` for the anon/authenticated roles: this is a PUBLIC,
  // unauthenticated sales-lead inbox, so there is no session/tenant to scope the
  // insert against. It is NOT an open door — the table holds no tenant data, and
  // writes are defended by the IP rate limit above (check_rate_limit) plus the
  // per-field length caps (LIMITS, mirrored by CHECK constraints). SELECT/UPDATE/
  // DELETE remain super-admin-only. Keep this the only writer of the table.
  const { error } = await supabase
    .from("information_requests")
    .insert({
      name,
      email,
      company,
      address_line1: clean(body.addressLine1, LIMITS.addressLine1),
      address_line2: clean(body.addressLine2, LIMITS.addressLine2),
      address_city: clean(body.addressCity, LIMITS.addressCity),
      address_region: clean(body.addressRegion, LIMITS.addressRegion),
      address_postal: clean(body.addressPostal, LIMITS.addressPostal),
      address_country: addressCountry,
      note: clean(body.note, LIMITS.note),
    })

  if (error) {
    return NextResponse.json(
      { error: "Could not save your request. Please try again." },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true })
}
