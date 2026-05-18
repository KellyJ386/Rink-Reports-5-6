"use server"

import { revalidatePath } from "next/cache"

import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

export async function hideDashboardModule(formData: FormData): Promise<void> {
  const moduleKey = String(formData.get("moduleKey") ?? "").trim()
  if (!moduleKey) return

  await requireUser()
  const supabase = await createClient()
  await supabase.rpc("hide_dashboard_module", { p_module_key: moduleKey })
  revalidatePath("/dashboard")
}

export async function showDashboardModule(formData: FormData): Promise<void> {
  const moduleKey = String(formData.get("moduleKey") ?? "").trim()
  if (!moduleKey) return

  await requireUser()
  const supabase = await createClient()
  await supabase.rpc("show_dashboard_module", { p_module_key: moduleKey })
  revalidatePath("/dashboard")
}
