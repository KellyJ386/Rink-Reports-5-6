"use server"

import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

import { isSafeRedirectPath } from "./redirect-safe"

export type LoginState = {
  error?: string
  email?: string
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  // Same-origin, path-only redirect target the proxy appended when it bounced
  // an unauthenticated user (validated to prevent open redirects).
  const safeRedirect = isSafeRedirectPath(formData.get("redirectTo"))

  if (!email || !password) {
    return { error: "Email and password are required.", email }
  }
  if (!email.includes("@") || email.length > 254) {
    return { error: "Enter a valid email address.", email }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: error.message, email }
  }

  redirect(safeRedirect ?? "/dashboard")
}
