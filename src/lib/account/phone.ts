import {
  parsePhoneNumberFromString,
  getCountries,
  getCountryCallingCode,
  type CountryCode,
} from "libphonenumber-js"

/**
 * Phone helpers shared by the client phone input and the server action.
 * Numbers are stored canonically in E.164 (e.g. "+14165551234").
 */

export const DEFAULT_COUNTRY: CountryCode = "US"

/**
 * Validate + normalize a phone number to E.164.
 * `country` is the fallback region used when the input has no "+" prefix.
 */
export function normalizePhone(
  value: string,
  country: CountryCode = DEFAULT_COUNTRY,
): { ok: true; e164: string } | { ok: false } {
  const trimmed = value.trim()
  if (!trimmed) return { ok: false }
  const parsed = parsePhoneNumberFromString(trimmed, country)
  if (!parsed || !parsed.isValid()) return { ok: false }
  return { ok: true, e164: parsed.number }
}

/** Best-effort national-format display for an E.164 (or raw) value. */
export function formatPhoneForDisplay(value: string | null | undefined): string {
  if (!value) return ""
  const parsed = parsePhoneNumberFromString(value)
  return parsed ? parsed.formatInternational() : value
}

/** The ISO country detected from an E.164 value, or the default. */
export function detectCountry(
  value: string | null | undefined,
  fallback: CountryCode = DEFAULT_COUNTRY,
): CountryCode {
  if (!value) return fallback
  return parsePhoneNumberFromString(value)?.country ?? fallback
}

export type CountryOption = {
  code: CountryCode
  name: string
  callingCode: string
}

/** Sorted list of selectable countries with localized names + calling codes. */
export function countryOptions(): CountryOption[] {
  const display =
    typeof Intl !== "undefined" && "DisplayNames" in Intl
      ? new Intl.DisplayNames(["en"], { type: "region" })
      : null
  return getCountries()
    .map((code) => ({
      code,
      name: display?.of(code) ?? code,
      callingCode: getCountryCallingCode(code),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export { getCountryCallingCode }
export type { CountryCode }
