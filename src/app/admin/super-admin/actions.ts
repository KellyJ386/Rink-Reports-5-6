"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { getCurrentUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import type { ActionState } from "./types"

async function requireSuperAdmin() {
  const current = await getCurrentUser()
  if (!current || !current.profile?.is_super_admin) {
    redirect("/forbidden")
  }
  return current
}

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

export async function setSuperAdminFlag(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSuperAdmin()

  const userId = formData.get("user_id")
  const value = formData.get("value") === "true"

  if (typeof userId !== "string" || !userId.trim()) {
    return { ok: false, error: "User ID is required." }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("users")
    .update({ is_super_admin: value })
    .eq("id", userId)

  if (error)
    return { ok: false, error: dbError(error, "Failed to update super-admin status.") }

  revalidatePath("/admin/super-admin")
  return {
    ok: true,
    message: value ? "User promoted to super admin." : "Super admin access revoked.",
  }
}

export async function setFacilityActive(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSuperAdmin()

  const facilityId = formData.get("facility_id")
  const value = formData.get("value") === "true"

  if (typeof facilityId !== "string" || !facilityId.trim()) {
    return { ok: false, error: "Facility ID is required." }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("facilities")
    .update({ is_active: value })
    .eq("id", facilityId)

  if (error)
    return { ok: false, error: dbError(error, "Failed to update facility status.") }

  revalidatePath("/admin/super-admin")
  return {
    ok: true,
    message: value ? "Facility activated." : "Facility deactivated.",
  }
}
