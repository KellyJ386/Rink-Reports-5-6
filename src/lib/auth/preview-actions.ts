"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { logAudit } from "@/lib/audit"
import { createClient } from "@/lib/supabase/server"

import { requireAdmin } from "./require-admin"
import { PREVIEW_COOKIE } from "./preview"

type ActionResult = { ok: true } | { ok: false; error: string }

const ONE_HOUR_SECONDS = 60 * 60

/**
 * Start previewing the app as the given employee. Admin-only. Redirects to
 * /dashboard on success so the admin immediately lands on the impersonated
 * staff view.
 */
export async function startPreviewAs(employeeId: string): Promise<ActionResult> {
  const current = await requireAdmin()
  if (!employeeId) return { ok: false, error: "Missing employee id." }

  const supabase = await createClient()
  let query = supabase
    .from("employees")
    .select("id, facility_id, first_name, last_name, is_active")
    .eq("id", employeeId)
    .eq("is_active", true)

  // Non-super admins can only preview employees in their own facility.
  if (!current.profile?.is_super_admin && current.profile?.facility_id) {
    query = query.eq("facility_id", current.profile.facility_id)
  }

  const { data: target } = await query.maybeSingle<{
    id: string
    facility_id: string
    first_name: string
    last_name: string
    is_active: boolean
  }>()

  if (!target) {
    return { ok: false, error: "Employee not found or not active." }
  }

  const store = await cookies()
  store.set(PREVIEW_COOKIE, target.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_HOUR_SECONDS,
  })

  await logAudit({
    facilityId: target.facility_id,
    action: "preview.start",
    entityType: "employees",
    entityId: target.id,
    after: {
      target_name: `${target.first_name} ${target.last_name}`.trim(),
    },
  })

  revalidatePath("/", "layout")
  redirect("/dashboard")
}

/**
 * Stop the current preview session. Idempotent — safe to call when no
 * preview is active.
 */
export async function stopPreview(): Promise<void> {
  const store = await cookies()
  const existing = store.get(PREVIEW_COOKIE)?.value ?? null
  store.delete(PREVIEW_COOKIE)

  if (existing) {
    const current = await requireAdmin()
    const facilityId = current.profile?.facility_id ?? null
    if (facilityId) {
      await logAudit({
        facilityId,
        action: "preview.stop",
        entityType: "employees",
        entityId: existing,
      })
    }
  }

  revalidatePath("/", "layout")
}
