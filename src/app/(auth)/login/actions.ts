"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

import { isSafeRedirectPath } from "./redirect-safe"

export type LoginState = {
  error?: string
  email?: string
}

// Trusted client IP (see the fuller rationale in the information-requests
// route): prefer the edge-set x-real-ip, else the rightmost — never leftmost —
// x-forwarded-for hop, both resistant to client spoofing.
async function clientIp(): Promise<string> {
  const h = await headers()
  const realIp = h.get("x-real-ip")?.trim()
  if (realIp) return realIp
  const xff = h.get("x-forwarded-for")
  if (xff) {
    const hops = xff.split(",").map((s) => s.trim()).filter(Boolean)
    const last = hops[hops.length - 1]
    if (last) return last
  }
  return "unknown"
}

const LOGIN_WINDOW_SECONDS = 600 // 10 minutes
// Per-IP cap blunts credential stuffing (one host, many accounts); per-email
// cap blunts a targeted guess (many hosts, one account).
const LOGIN_MAX_PER_IP = 30
const LOGIN_MAX_PER_EMAIL = 8

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

  // Application-layer brute-force throttle (backs up GoTrue's coarse limits).
  // Fail OPEN on a limiter error: locking every login out on an infra blip is a
  // worse outcome than a brief throttling gap, and GoTrue still applies its own
  // caps. The generic message avoids revealing whether the email exists.
  const ip = await clientIp()
  const buckets: ReadonlyArray<[string, string, number]> = [
    ["login_ip", ip, LOGIN_MAX_PER_IP],
    ["login_email", email.toLowerCase(), LOGIN_MAX_PER_EMAIL],
  ]
  for (const [bucket, identifier, max] of buckets) {
    const { data: allowed, error: rateError } = await supabase.rpc(
      "check_rate_limit",
      {
        p_bucket: bucket,
        p_identifier: identifier,
        p_max: max,
        p_window_seconds: LOGIN_WINDOW_SECONDS,
      },
    )
    if (!rateError && allowed === false) {
      return {
        error: "Too many attempts. Please wait a few minutes and try again.",
        email,
      }
    }
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: error.message, email }
  }

  redirect(safeRedirect ?? "/dashboard")
}
