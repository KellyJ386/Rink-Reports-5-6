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

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

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
  { key: "gm", display_name: "General Manager", hierarchy_level: 2 },
  { key: "manager", display_name: "Manager", hierarchy_level: 3 },
  { key: "supervisor", display_name: "Supervisor", hierarchy_level: 4 },
  { key: "staff", display_name: "Staff", hierarchy_level: 5 },
] as const
