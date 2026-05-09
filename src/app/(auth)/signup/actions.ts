"use server"

import { createClient } from "@/lib/supabase/server"

export type SignupState = {
  error?: string
  success?: boolean
  email?: string
  fullName?: string
  needsConfirmation?: boolean
}

export async function signupAction(
  _prev: SignupState,
  formData: FormData
): Promise<SignupState> {
  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  const fullName = String(formData.get("full_name") ?? "").trim()

  if (!email || !password || !fullName) {
    return {
      error: "Email, password, and full name are required.",
      email,
      fullName,
    }
  }
  if (!email.includes("@") || email.length > 254) {
    return { error: "Enter a valid email address.", email, fullName }
  }

  if (password.length < 8) {
    return {
      error: "Password must be at least 8 characters.",
      email,
      fullName,
    }
  }

  const supabase = await createClient()

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
    },
  })

  if (error) {
    return { error: error.message, email, fullName }
  }

  const userId = data.user?.id
  if (userId) {
    // Insert the profile row. If a DB trigger already created one this will
    // upsert idempotently.
    const { error: insertError } = await supabase.from("users").upsert(
      {
        id: userId,
        email,
        full_name: fullName,
        // facility_id intentionally null — assigned by an admin afterwards.
      },
      { onConflict: "id" }
    )

    if (insertError) {
      return {
        error: `Account created but profile setup failed: ${insertError.message}`,
        email,
        fullName,
      }
    }
  }

  return {
    success: true,
    needsConfirmation: !data.session,
    email,
    fullName,
  }
}
