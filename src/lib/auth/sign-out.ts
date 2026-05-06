"use server"

import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

/**
 * Server action: signs the current user out and redirects to /login.
 */
export async function signOut(): Promise<never> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/login")
}
