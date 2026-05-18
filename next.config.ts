import type { NextConfig } from "next"

// `'unsafe-inline'` for script-src/style-src is required because Next.js
// emits inline bootstrap scripts during hydration and Tailwind v4 +
// shadcn/ui ship inline <style> tags. Switching to nonce-based CSP would
// need a custom proxy that injects a per-request nonce into every inline
// tag — out of scope for this baseline.
const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // *.i.posthog.com covers the default US cloud endpoint
  // (us.i.posthog.com); EU customers point at eu.i.posthog.com. For
  // self-hosted PostHog, add the host explicitly here.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.i.posthog.com",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ")

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  // CSP is enforced only in production; dev/HMR needs inline eval and
  // would break under this policy.
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Content-Security-Policy", value: cspDirectives }]
    : []),
]

const nextConfig: NextConfig = {
  // Next.js <Image> optimization output. Default omits AVIF; explicitly
  // listing it first lets supporting browsers pull the lighter format.
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
