import { NextRequest, NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "@/lib/auth"

export async function POST(request: NextRequest) {
  const current = await getCurrentUser()
  if (!current?.authUser) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
  }

  const { profile } = current
  if (!profile?.is_active || !profile?.facility_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let body: {
    localId?: string
    moduleKey?: string
    action?: string
    payload?: Record<string, unknown>
    startedAt?: number
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { localId, moduleKey, action = "submit", payload, startedAt } = body

  if (!localId || !moduleKey || !payload) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

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

  // Upsert into the sync queue (ON CONFLICT local_id = no-op for dedup)
  const { error } = await supabase
    .from("offline_sync_queue")
    .upsert(
      {
        local_id: localId,
        facility_id: profile.facility_id,
        employee_id: employee.id,
        module_key: moduleKey,
        action,
        payload,
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
