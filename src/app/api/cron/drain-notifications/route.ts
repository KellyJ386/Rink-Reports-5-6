import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

import type { Database } from "@/types/database"

// Force this route to be dynamic; otherwise Next will try to evaluate the
// service-role env vars at build time.
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Drains notification_outbox by invoking drain_notification_outbox().
 *
 * Expected to be called by an external scheduler (Vercel Cron, GitHub
 * Actions, supabase scheduled function, etc.) — see vercel.json. The
 * scheduler must send `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Uses the service-role key so it can call SECURITY DEFINER functions
 * regardless of any RLS context. The service-role key MUST live only in
 * server env vars and never be exposed to the browser.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 503 },
    )
  }

  const authHeader = request.headers.get("authorization") ?? ""
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    )
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json(
      { ok: false, error: "Supabase service-role env not configured" },
      { status: 503 },
    )
  }

  const supabase = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // drain_notification_outbox isn't in generated types yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(
    "drain_notification_outbox",
    { p_max_rows: 500 },
  )

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    )
  }

  const row = Array.isArray(data) ? data[0] : data
  return NextResponse.json({
    ok: true,
    sent: row?.sent_count ?? 0,
    failed: row?.failed_count ?? 0,
    messages: row?.message_count ?? 0,
  })
}
