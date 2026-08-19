"use server"

import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

export type UpdatePasswordState = {
  error?: string
  message?: string
}

export async function updatePasswordAction(
  _prev: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  const password = String(formData.get("password") ?? "")
  const confirm = String(formData.get("confirm_password") ?? "")

  // Keep in sync with minimum_password_length in supabase/config.toml (and
  // the hosted project's Auth settings) so GoTrue never rejects a password
  // this form already accepted.
  if (password.length < 12) {
    return { error: "Password must be at least 12 characters." }
  }
  if (password !== confirm) {
    return { error: "Passwords do not match." }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return {
      error:
        "Your invite link has expired. Ask your administrator to re-send it.",
    }
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    return { error: error.message }
  }

  redirect("/dashboard")
}
