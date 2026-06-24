// Local types for the Lists admin module (generic per-facility dropdown
// options). Row type comes from the generated Supabase types; the DOMAINS
// whitelist + key validators live here and are pure/testable (no server-only
// imports) so compute logic can be unit-tested with vitest.

import type { Tables } from "@/types/database"

export type FacilityDropdownOptionRow = Tables<"facility_dropdown_options">

// Whitelisted domains. MUST stay in sync with the `domain` CHECK in
// migration 00000000000153. Only add a domain whose new values actually
// function end-to-end — code-bound enums do NOT belong here.
export const DOMAINS = ["facility_timezone"] as const
export type DropdownDomain = (typeof DOMAINS)[number]

export function isDomain(value: string): value is DropdownDomain {
  return (DOMAINS as readonly string[]).includes(value)
}

export type KeyKind = "iana_timezone" | "slug"

export type DomainConfig = {
  domain: DropdownDomain
  /** Nav chip + page heading. */
  label: string
  /** Lowercase singular noun used in buttons ("Add timezone"). */
  singular: string
  description: string
  keyKind: KeyKind
  keyLabel: string
  keyPlaceholder: string
  keyHelp: string
}

export const DOMAIN_CONFIG: Record<DropdownDomain, DomainConfig> = {
  facility_timezone: {
    domain: "facility_timezone",
    label: "Timezones",
    singular: "timezone",
    description:
      "Time zones offered in the Facility settings picker. The key is the IANA identifier stored on the facility; the display name is the friendly label staff see.",
    keyKind: "iana_timezone",
    keyLabel: "IANA time zone",
    keyPlaceholder: "America/New_York",
    keyHelp:
      "A valid IANA identifier (e.g. America/Chicago). Stored verbatim as the facility's timezone.",
  },
}

export const DOMAIN_LIST: ReadonlyArray<DomainConfig> = DOMAINS.map(
  (d) => DOMAIN_CONFIG[d],
)

const SLUG_KEY_RE = /^[a-z0-9_]+$/

/**
 * True iff `key` is an IANA time zone the runtime recognizes. Intl throws a
 * RangeError for unknown zones; we treat that as invalid. Pure + testable.
 */
export function isValidTimezone(key: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: key })
    return true
  } catch {
    return false
  }
}

/**
 * Per-domain key validation. The DB only constrains uniqueness, so this is the
 * gate that keeps a domain's keys meaningful (e.g. a real IANA zone for
 * facility_timezone). Called by the server action before any write.
 */
export function validateDomainKey(
  domain: DropdownDomain,
  key: string,
): { ok: true } | { ok: false; error: string } {
  const kind = DOMAIN_CONFIG[domain].keyKind
  if (kind === "iana_timezone") {
    return isValidTimezone(key)
      ? { ok: true }
      : {
          ok: false,
          error: `"${key}" is not a valid IANA time zone (e.g. America/New_York).`,
        }
  }
  return SLUG_KEY_RE.test(key)
    ? { ok: true }
    : {
        ok: false,
        error: "Key must be lowercase letters, digits, and underscores.",
      }
}

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }

export type SimpleResult = { ok: true } | { ok: false; error: string }
