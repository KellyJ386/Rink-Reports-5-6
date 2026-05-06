"use server"

import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

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

  if (!email || !password) {
    return { error: "Email and password are required.", email }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: error.message, email }
  }

  redirect("/admin")
}
