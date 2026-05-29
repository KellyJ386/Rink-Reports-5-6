import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "@/lib/auth"
import type { Json } from "@/types/database"

// Validate the queued submission shape before it touches the DB, so a bad
// payload surfaces as a 400 here rather than an opaque RLS/insert failure.
// `action` mirrors the enqueueSubmission() client contract (a string defaulting
// to "submit") rather than a fixed enum, so a future action value can't silently
// 400 on replay and get marked failed by the service worker.
const bodySchema = z.object({
  localId: z.string().min(1),
  moduleKey: z.string().min(1),
  action: z.string().min(1).default("submit"),
  payload: z.record(z.string(), z.unknown()),
  startedAt: z.number().int().positive().optional(),
})

export async function POST(request: NextRequest) {
  const current = await getCurrentUser()
  if (!current?.authUser) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
  }

  const { profile } = current
  if (!profile?.is_active || !profile?.facility_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 })
  }

  const { localId, moduleKey, action, payload, startedAt } = parsed.data

  const supabase = await createClient()

  // Resolve active employee
  const { data: employee } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", profile.id)
    .eq("facility_id", profile.facility_id)
    .eq("is_active", true)
    .maybeSingle()

  if (!employee) {
    return NextResponse.json({ error: "No active employee" }, { status: 403 })
  }

  // Upsert into the sync queue (ON CONFLICT local_id = no-op for dedup).
  const { error } = await supabase
    .from("offline_sync_queue")
    .upsert(
      {
        local_id: localId,
        facility_id: profile.facility_id,
        employee_id: employee.id,
        module_key: moduleKey,
        action,
        payload: payload as Json,
        sync_status: "synced",
        started_at: startedAt ? new Date(startedAt).toISOString() : new Date().toISOString(),
        synced_at: new Date().toISOString(),
      },
      { onConflict: "local_id", ignoreDuplicates: true }
    )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
