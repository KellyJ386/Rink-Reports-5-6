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

  // The public.users profile row is created automatically by the
  // on_auth_user_created trigger (handle_new_user), which runs SECURITY
  // DEFINER and therefore bypasses RLS. We do not insert here because when
  // email confirmation is enabled signUp() returns no session, making the
  // client anon-role — any authenticated-only INSERT policy would fail.

  return {
    success: true,
    needsConfirmation: !data.session,
    email,
    fullName,
  }
}
