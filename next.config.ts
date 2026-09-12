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
  // Sever `window.opener` handles: any page that opens this app in a new
  // window/tab lands in a separate browsing context group, so it can neither
  // script us nor be scripted by us. Cheap tab-napping/XS-Leak hardening; the
  // app never needs a cross-origin opener relationship (the Supabase auth
  // flows here are redirect/OTP-based, not popup-based).
  // Cross-Origin-Resource-Policy is deliberately NOT set: PostHog's session
  // replay player (loaded on posthog.com origins) re-fetches this app's
  // stylesheets/images cross-origin to render recordings, and CORP
  // `same-origin` on those responses would break it. Revisit if PostHog is
  // dropped.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
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

const TRAINING_DOC_FILES = [
  "./docs/training/**/*",
  "./docs/training-guide/**/*",
  "./docs/pwa-install-guide.md",
  "./docs/admin-setup-guide.md",
]

const nextConfig: NextConfig = {
  // Next.js <Image> optimization output. Default omits AVIF; explicitly
  // listing it first lets supporting browsers pull the lighter format.
  images: {
    formats: ["image/avif", "image/webp"],
  },
  // The admin Training & Documentation pages read the training manuals from
  // `docs/` at request time (see src/lib/training-docs.ts for the manifest).
  // Those files aren't imported by any module, so the server trace wouldn't
  // otherwise ship them to Vercel. Keys are route globs; the list must cover
  // every path the manifest can point at.
  outputFileTracingIncludes: {
    "/admin/training": TRAINING_DOC_FILES,
    "/admin/training/**": TRAINING_DOC_FILES,
  },
  // The reader in read-doc.ts is statically scoped to docs/, so the tracer
  // pulls that whole folder into the training routes. Drop the parts no
  // training doc lives in (archived audits, design notes) to keep the
  // function bundles small. Excludes apply AFTER includes, so never list a
  // folder here that TRAINING_DOC_FILES needs.
  outputFileTracingExcludes: {
    "/admin/training/**": ["./docs/archive/**/*", "./docs/ui/**/*"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ]
  },
  // The Rink Scheduling module was renamed to Facility Scheduling in the UI;
  // these routes moved with it. Keep redirecting old links/bookmarks (the
  // module's own `module_name` / RLS grant key stays `rink_scheduling` and is
  // untouched by this rename).
  async redirects() {
    return [
      {
        source: "/reports/rink-scheduling/:path*",
        destination: "/reports/facility-scheduling/:path*",
        permanent: false,
      },
      {
        source: "/admin/rink-scheduling/:path*",
        destination: "/admin/facility-scheduling/:path*",
        permanent: false,
      },
      {
        source: "/offline-rink-schedule",
        destination: "/offline-facility-schedule",
        permanent: false,
      },
    ]
  },
}

export default nextConfig
