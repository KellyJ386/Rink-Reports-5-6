import type { Tables } from "@/types/database"

export type FacilityRow = Tables<"facilities">

export type FacilityListItem = FacilityRow & {
  employee_count: number
}

export type FacilityCounts = {
  employees: number
  departments: number
  roles: number
}

export type FacilityFormInput = {
  name: string
  slug: string
  timezone: string
  is_active?: boolean
  address?: string | null
  city?: string | null
  state?: string | null
  zip_code?: string | null
  phone?: string | null
  email?: string | null
}

/**
 * Names that may carry per-field validation errors back from the
 * facility form action. Keep in sync with the form's input `name`
 * attributes so the form-side dispatcher can look them up directly.
 */
export type FacilityFieldName = "name" | "slug" | "email"

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | {
      ok: false
      error: string
      // Optional per-field errors. Older consumers can ignore this and
      // keep rendering `error` alone; the facility form opts in to
      // routing each fieldErrors entry to its corresponding <FieldError>.
      fieldErrors?: Partial<Record<FacilityFieldName, string>>
    }

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Seed defaults + fallback for the timezone picker. The picker is now
 * per-facility and admin-editable via facility_dropdown_options (domain
 * `facility_timezone`, managed at /admin/lists) — these values are what the DB
 * seed function plants, and what the facility form falls back to when a
 * facility has no rows yet. Storage accepts any valid IANA zone, so this list
 * is no longer the validation gate (see normalizeTimezone in actions.ts).
 */
export const TIMEZONE_OPTIONS: ReadonlyArray<string> = [
  "America/New_York",
  "America/Detroit",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "UTC",
] as const

export const DEFAULT_TIMEZONE = "America/New_York"

export const CANONICAL_ROLES: ReadonlyArray<{
  key: string
  display_name: string
  hierarchy_level: number
}> = [
  { key: "super_admin", display_name: "Super Admin", hierarchy_level: 0 },
  { key: "admin", display_name: "Administrator", hierarchy_level: 1 },
  { key: "manager", display_name: "Manager", hierarchy_level: 2 },
  { key: "staff", display_name: "Staff", hierarchy_level: 3 },
] as const
