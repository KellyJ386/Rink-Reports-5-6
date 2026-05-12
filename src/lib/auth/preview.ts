import "server-only"

import { cookies } from "next/headers"

import { createClient } from "@/lib/supabase/server"

import { getCurrentUser } from "./get-current-user"

export const PREVIEW_COOKIE = "rr_preview_employee_id"

export type PreviewContext = {
  active: boolean
  /** Effective employee id used for app-level module visibility. */
  effectiveEmployeeId: string | null
  /** The admin's own active employee id. Always present when authenticated. */
  realEmployeeId: string | null
  /** Display fields about the preview target — only set when active. */
  target: {
    id: string
    fullName: string
    roleKey: string | null
    roleDisplayName: string | null
  } | null
}

/**
 * Resolve the effective employee context for the current request.
 *
 * Preview is active only when ALL of the following hold:
 *   1. There is a signed-in user.
 *   2. The user's profile is an active admin/gm/super_admin (or is_super_admin).
 *   3. A PREVIEW_COOKIE is set.
 *   4. The cookie value is an active employee in the admin's facility
 *      (or any facility if the caller is super_admin).
 *
 * If any check fails, the cookie is treated as not present. RLS still runs
 * against the admin's auth.uid() — preview only narrows what the app
 * chooses to render, never broadens what they can read.
 */
export async function getPreviewContext(): Promise<PreviewContext> {
  const current = await getCurrentUser()
  if (!current?.authUser || !current.profile) {
    return {
      active: false,
      effectiveEmployeeId: null,
      realEmployeeId: null,
      target: null,
    }
  }

  const supabase = await createClient()
  const { data: realEmp } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{ id: string }>()
  const realEmployeeId = realEmp?.id ?? null

  // Only admins may preview. Mirror the test in requireAdmin without
  // redirecting — non-admins simply see preview as inactive.
  const profile = current.profile
  let isAdmin = profile.is_super_admin === true
  if (!isAdmin && profile.is_active && realEmployeeId) {
    const { data: adminEmp } = await supabase
      .from("employees")
      .select("id, roles!inner(key)")
      .eq("id", realEmployeeId)
      .in("roles.key", ["admin", "gm", "super_admin"])
      .limit(1)
      .maybeSingle()
    isAdmin = adminEmp !== null
  }

  if (!isAdmin) {
    return {
      active: false,
      effectiveEmployeeId: realEmployeeId,
      realEmployeeId,
      target: null,
    }
  }

  const store = await cookies()
  const cookieValue = store.get(PREVIEW_COOKIE)?.value ?? null
  if (!cookieValue) {
    return {
      active: false,
      effectiveEmployeeId: realEmployeeId,
      realEmployeeId,
      target: null,
    }
  }

  // Validate that the cookie names an employee the admin may preview.
  let query = supabase
    .from("employees")
    .select("id, first_name, last_name, is_active, roles!inner(key, display_name)")
    .eq("id", cookieValue)
    .eq("is_active", true)
  if (!profile.is_super_admin && profile.facility_id) {
    query = query.eq("facility_id", profile.facility_id)
  }
  const { data: target } = await query.maybeSingle<{
    id: string
    first_name: string
    last_name: string
    is_active: boolean
    roles: { key: string; display_name: string } | null
  }>()

  if (!target) {
    return {
      active: false,
      effectiveEmployeeId: realEmployeeId,
      realEmployeeId,
      target: null,
    }
  }

  return {
    active: true,
    effectiveEmployeeId: target.id,
    realEmployeeId,
    target: {
      id: target.id,
      fullName: `${target.first_name} ${target.last_name}`.trim() || "Unnamed",
      roleKey: target.roles?.key ?? null,
      roleDisplayName: target.roles?.display_name ?? null,
    },
  }
}
