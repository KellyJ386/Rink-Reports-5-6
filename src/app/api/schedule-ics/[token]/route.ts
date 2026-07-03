import { NextResponse } from "next/server"

import { buildIcsCalendar, type IcsEvent } from "@/lib/ics"
import { logServerError } from "@/lib/observability/log-server-error"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

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
    const { data: tokenRow } = await admin
      .from("schedule_ics_tokens")
      .select("employee_id, facility_id")
      .eq("token", token)
      .maybeSingle<{ employee_id: string; facility_id: string }>()
    if (!tokenRow) {
      return NextResponse.json({ error: "not found" }, { status: 404 })
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
