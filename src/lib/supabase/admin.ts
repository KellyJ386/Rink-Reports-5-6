import "server-only"

import { createClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database"

// Distinguish each misconfiguration mode so callers can surface a precise
// admin-friendly message instead of a generic "not configured".
export type ServiceRoleEnvError = {
  kind:
    | "missing_url"
    | "missing_key"
    | "placeholder_url"
    | "placeholder_key"
    | "missing_site_url"
    | "invalid_site_url"
    | "blank_key"
    | "malformed_key"
  message: string
}

export type ServiceRoleEnvCheck =
  | { ok: true; url: string; serviceKey: string }
  | { ok: false; error: ServiceRoleEnvError }

export type SiteUrlCheck =
  | { ok: true; siteUrl: string }
  | { ok: false; error: ServiceRoleEnvError }

export type ServiceRoleKeyDebugInfo = {
  rawLength: number
  normalizedLength: number
  hadWrappingQuotes: boolean
  hasWhitespace: boolean
  startsWithEyJ: boolean
  startsWithSbSecret: boolean
}

// Supabase supports two service-role key formats and supabase-js handles
// both transparently:
//   1. Legacy HS256 JWT — three base64url segments joined by dots, header
//      always decodes to `{"alg":"HS256","typ":"JWT"}` so it starts with `eyJ`.
//      Real service-role JWTs are 200+ chars.
//   2. New structured API keys (rolled out 2024+) — prefixed with `sb_secret_`
//      followed by an opaque random string. See
//      https://supabase.com/docs/guides/api/api-keys
const LEGACY_JWT_SHAPE =
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+=*$/
const NEW_SECRET_KEY_SHAPE = /^sb_secret_[^\s]{16,}$/

function normalizeServiceRoleKey(rawValue: string): string {
  const trimmed = rawValue.trim()
  // Support quoted env values from .env files / dashboard copy-paste:
  // SUPABASE_SERVICE_ROLE_KEY="sb_secret_..."
  // SUPABASE_SERVICE_ROLE_KEY='eyJ...'
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

export function getServiceRoleKeyDebugInfo(rawValue: string): ServiceRoleKeyDebugInfo {
  const trimmed = rawValue.trim()
  const hadWrappingQuotes =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  const normalized = normalizeServiceRoleKey(rawValue)
  return {
    rawLength: rawValue.length,
    normalizedLength: normalized.length,
    hadWrappingQuotes,
    hasWhitespace: /\s/.test(rawValue),
    startsWithEyJ: normalized.startsWith("eyJ"),
    startsWithSbSecret: normalized.startsWith("sb_secret_"),
  }
}

export function checkSiteUrlEnv(): SiteUrlCheck {
  const raw = process.env.NEXT_PUBLIC_SITE_URL ?? ""
  const siteUrl = raw.trim().replace(/\/$/, "")
  if (!siteUrl) {
    return {
      ok: false,
      error: {
        kind: "missing_site_url",
        message:
          "NEXT_PUBLIC_SITE_URL is not set. Set it to your deployed app URL so invite/reset links do not point to localhost.",
      },
    }
  }
  try {
    const parsed = new URL(siteUrl)
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
      return {
        ok: false,
        error: {
          kind: "invalid_site_url",
          message:
            "NEXT_PUBLIC_SITE_URL must be https in non-local environments.",
        },
      }
    }
    return { ok: true, siteUrl }
  } catch {
    return {
      ok: false,
      error: {
        kind: "invalid_site_url",
        message:
          "NEXT_PUBLIC_SITE_URL is invalid. Use a full URL like https://app.example.com.",
      },
    }
  }
}

function looksLikeServiceRoleKey(value: string): boolean {
  if (NEW_SECRET_KEY_SHAPE.test(value)) return true
  if (LEGACY_JWT_SHAPE.test(value)) return true
  return false
}

const PLACEHOLDER_KEY_HINTS = [
  "your-service-role-key",
  "your-service-role",
  "your_service_role",
  "service-role-key-here",
  "service_role_key_here",
  "replace-me",
  "changeme",
]
const PLACEHOLDER_URL_HINTS = ["your-project-ref", "your_project_ref"]

/**
 * Validates the env vars used to construct the service-role client without
 * actually instantiating one. Catches the common ".env.local copied from
 * .env.example and never filled in" foot-gun that otherwise reaches GoTrue
 * as a missing/invalid Bearer header.
 */
export function checkServiceRoleEnv(): ServiceRoleEnvCheck {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  const url = rawUrl.trim()
  const serviceKey = normalizeServiceRoleKey(rawKey)

  if (!url) {
    return {
      ok: false,
      error: {
        kind: "missing_url",
        message: "NEXT_PUBLIC_SUPABASE_URL is not set.",
      },
    }
  }
  if (PLACEHOLDER_URL_HINTS.some((hint) => url.toLowerCase().includes(hint))) {
    return {
      ok: false,
      error: {
        kind: "placeholder_url",
        message:
          "NEXT_PUBLIC_SUPABASE_URL is still a placeholder from .env.example — set the real project URL.",
      },
    }
  }
  if (!serviceKey) {
    // Empty string OR all-whitespace falls here.
    return {
      ok: false,
      error: {
        kind: rawKey.length > 0 ? "blank_key" : "missing_key",
        message:
          rawKey.length > 0
            ? "SUPABASE_SERVICE_ROLE_KEY is set but blank (whitespace-only)."
            : "SUPABASE_SERVICE_ROLE_KEY is not set.",
      },
    }
  }
  if (
    PLACEHOLDER_KEY_HINTS.some((hint) =>
      serviceKey.toLowerCase().includes(hint),
    )
  ) {
    return {
      ok: false,
      error: {
        kind: "placeholder_key",
        message:
          "SUPABASE_SERVICE_ROLE_KEY is still a placeholder from .env.example. Copy the real service_role key from the Supabase dashboard (Settings → API).",
      },
    }
  }
  if (!looksLikeServiceRoleKey(serviceKey)) {
    return {
      ok: false,
      error: {
        kind: "malformed_key",
        message:
          "SUPABASE_SERVICE_ROLE_KEY doesn't match either supported format: a legacy JWT (`eyJ…` with three dot-separated base64 segments) or a new-format secret key (`sb_secret_…`). Re-copy the service_role key from the Supabase dashboard (Settings → API) — make sure you grabbed the `service_role` secret, not the `anon` / `publishable` key.",
      },
    }
  }
  return { ok: true, url, serviceKey }
}

/**
 * Server-only Supabase client authenticated with the service-role key.
 * Use sparingly — bypasses RLS. Required for auth.admin.* operations
 * (e.g. inviting new users by email).
 *
 * Throws a descriptive Error if SUPABASE_SERVICE_ROLE_KEY is missing,
 * blank, a placeholder, or not JWT-shaped — preventing the
 * supabase-js client from silently sending requests with a header
 * that GoTrue rejects as `no_authorization`.
 */
export function createAdminClient() {
  const check = checkServiceRoleEnv()
  if (!check.ok) {
    throw new Error(check.error.message)
  }
  return createClient<Database>(check.url, check.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
