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
