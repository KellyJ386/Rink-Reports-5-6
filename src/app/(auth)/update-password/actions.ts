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

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." }
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
