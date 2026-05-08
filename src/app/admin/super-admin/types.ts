export type FacilityRow = {
  id: string
  name: string
  slug: string
  timezone: string
  is_active: boolean
  created_at: string
}

export type FacilityWithStats = FacilityRow & {
  employee_count: number
}

export type SuperAdminUserRow = {
  id: string
  email: string
  full_name: string | null
  is_super_admin: boolean
  is_active: boolean
  last_seen_at: string | null
  created_at: string
  facility_id: string | null
  facility_name: string | null
}

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }
