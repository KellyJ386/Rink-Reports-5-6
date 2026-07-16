import type { NextConfig } from "next"

// The Content-Security-Policy is NOT set here. It is nonce-based and therefore
// per-request, so it is generated and attached in the proxy
// (src/lib/supabase/session.ts -> buildCsp), where a fresh nonce is minted for
// each request and enforced in production only. The static headers below apply
// to every route via the headers() config.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  // Force HTTPS for two years and cover subdomains. This app is a PWA that
  // stores auth cookies, so a first-visit / same-network SSL-strip is a real
  // risk. `preload` opts into the browser preload list (submit the apex domain
  // at hstspreload.org). Vercel may also set this at the edge; a duplicate is
  // harmless. HSTS is ignored over plain HTTP (local dev), so it is safe here.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
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
