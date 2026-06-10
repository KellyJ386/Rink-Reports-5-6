import { createHash, timingSafeEqual } from "node:crypto"

import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

import { getEmailDeliveryGate } from "@/lib/notifications/transport/email"

// Force dynamic; env vars must be read per-request, never at build.
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 15

/**
 * Deployment health check, consumed by the post-deploy smoke workflow
 * (.github/workflows/post-deploy-smoke.yml) and useful for uptime monitors.
 *
 * Returns 200 only when every REQUIRED runtime dependency is present and the
 * database is reachable; 503 otherwise. This is what makes misconfiguration
 * loud: before this endpoint existed, a deploy with a missing CRON_SECRET or
 * service-role key would 401/503 inside the cron routes forever and nobody
 * would notice until notifications stopped arriving.
 *
 * Two disclosure levels:
 *  - Unauthenticated: coarse booleans only ({ ok, checks: { env, db } }).
 *  - With `Authorization: Bearer ${CRON_SECRET}` (same timing-safe compare
 *    as the cron routes): per-variable presence booleans, the email delivery
 *    gate decision, and deploy metadata (commit, environment).
 */
export async function GET(request: Request) {
  const required = {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    CRON_SECRET: Boolean(process.env.CRON_SECRET),
  }
  const envOk = Object.values(required).every(Boolean)

  const dbOk = await checkDatabaseReachable()
  const ok = envOk && dbOk

  const secret = process.env.CRON_SECRET
  const detailed =
    Boolean(secret) &&
    authorize(request.headers.get("authorization"), secret as string)

  if (!detailed) {
    return NextResponse.json(
      { ok, checks: { env: envOk, db: dbOk } },
      { status: ok ? 200 : 503 },
    )
  }

  const emailGate = getEmailDeliveryGate()
  return NextResponse.json(
    {
      ok,
      checks: { env: envOk, db: dbOk },
      required,
      optional: {
        NEXT_PUBLIC_SITE_URL: Boolean(process.env.NEXT_PUBLIC_SITE_URL),
        RESEND_API_KEY: Boolean(process.env.RESEND_API_KEY),
        RESEND_FROM: Boolean(process.env.RESEND_FROM),
        NEXT_PUBLIC_POSTHOG_KEY: Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY),
      },
      emailDelivery: emailGate,
      deploy: {
        commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
        environment:
          process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
      },
    },
    { status: ok ? 200 : 503 },
  )
}

/**
 * Proves URL + anon key are valid and Postgres answers. A head-count query
 * runs under RLS as anon (returns zero rows) — success here means
 * reachability, not data access.
 */
async function checkDatabaseReachable(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return false

  try {
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await supabase
      .from("facilities")
      .select("id", { count: "exact", head: true })
      .abortSignal(AbortSignal.timeout(5_000))
    return !error
  } catch {
    return false
  }
}

// Same timing-safe bearer compare as the cron routes.
function authorize(header: string | null, secret: string): boolean {
  if (!header) return false
  const expected = `Bearer ${secret}`
  const a = createHash("sha256").update(header).digest()
  const b = createHash("sha256").update(expected).digest()
  return a.length === b.length && timingSafeEqual(a, b)
}
