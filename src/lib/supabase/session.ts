import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import type { Database } from "@/types/database"

const AUTH_PAGES = ["/login"]

// All routes that require an authenticated session
const PROTECTED_PREFIXES = ["/admin", "/reports", "/dashboard", "/account"]

// Content Security Policy.
//
// script-src is nonce-based: a fresh per-request nonce plus 'strict-dynamic',
// with NO 'unsafe-inline'. Next.js reads the nonce from the request's CSP
// header during SSR and stamps it onto its own framework/bootstrap scripts and
// bundle chunks; the one hand-authored inline script (the pre-paint theme
// script in app/layout.tsx) reads the nonce from the `x-nonce` request header.
// 'strict-dynamic' lets those nonce-trusted scripts load the rest of the graph.
//
// style-src deliberately keeps 'unsafe-inline'. The app renders ~230 React
// `style={{…}}` attributes (SVG rink diagrams, the scheduling grid, dynamic
// module theming); a nonce-only style-src would block every one of them, and
// style-based injection is a far weaker vector than script execution. Tightening
// this would be a large, separate refactor.
//
// Enforced in production only — Next dev/HMR needs inline eval and would break
// under this policy (matches the prior next.config.ts behavior).
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // *.i.posthog.com covers the default US cloud endpoint
    // (us.i.posthog.com); EU customers point at eu.i.posthog.com. For
    // self-hosted PostHog, add the host explicitly here.
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.i.posthog.com",
    "worker-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ")
}

export async function updateSession(request: NextRequest) {
  const isProd = process.env.NODE_ENV === "production"
  // A fresh, unpredictable nonce per request. base64 of a random UUID is
  // plenty of entropy for a single-use CSP nonce.
  const nonce = isProd
    ? Buffer.from(crypto.randomUUID()).toString("base64")
    : ""
  const csp = isProd ? buildCsp(nonce) : ""

  // Next.js extracts the nonce from the CSP on the *request* headers during
  // SSR; app/layout.tsx reads it back via the `x-nonce` header. Build the
  // forwarded request headers once and reuse them for every NextResponse.next
  // below so the nonce survives the Supabase cookie round-trips.
  const buildRequestHeaders = () => {
    const headers = new Headers(request.headers)
    if (isProd) {
      headers.set("x-nonce", nonce)
      headers.set("content-security-policy", csp)
    }
    return headers
  }

  let supabaseResponse = NextResponse.next({
    request: { headers: buildRequestHeaders() },
  })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request: { headers: buildRequestHeaders() },
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: Avoid writing any logic between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  const withCsp = (response: NextResponse) => {
    if (isProd) response.headers.set("content-security-policy", csp)
    return response
  }

  // Unauthenticated users on any protected route -> redirect to /login
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))
  if (!user && isProtected) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("redirectTo", pathname)
    return withCsp(NextResponse.redirect(url))
  }

  // Authenticated users on /login -> redirect to /dashboard
  if (user && AUTH_PAGES.includes(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = "/dashboard"
    url.search = ""
    return withCsp(NextResponse.redirect(url))
  }

  return withCsp(supabaseResponse)
}
