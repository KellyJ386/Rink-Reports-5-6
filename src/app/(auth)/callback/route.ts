import { type EmailOtpType } from "@supabase/supabase-js"
import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"

import { isSafeRedirectPath } from "../login/redirect-safe"

// Auth callback for server-generated email links (invite + password reset).
//
// Supabase's `inviteUserByEmail` / `generateLink` produce links that hit
// GoTrue's verify endpoint, which then redirects here with either a `code`
// (PKCE) or a `token_hash` + `type` (OTP). Either way we must exchange that
// one-time token for a cookie-based session before the user can use
// `/update-password`. Without this step `supabase.auth.getUser()` returns null
// and the password form fails with "Your invite link has expired."

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  // Use the same hardened path validator as password login. A simple
  // `startsWith("/")` check is insufficient because URL parsers normalize
  // backslashes: `/\evil.example` resolves to the external evil.example
  // origin when passed to `new URL()`.
  const next = isSafeRedirectPath(searchParams.get("next")) ?? "/update-password"
  const code = searchParams.get("code")
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null

  const supabase = await createClient()

  let ok = false
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    ok = !error
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    })
    ok = !error
  }

  if (ok) {
    return NextResponse.redirect(new URL(next, request.url))
  }

  const failUrl = new URL("/update-password", request.url)
  failUrl.searchParams.set("error", "link_expired")
  return NextResponse.redirect(failUrl)
}
