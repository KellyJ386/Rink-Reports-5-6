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
  // `resetLink` is a one-time recovery credential (full account takeover): it is
  // returned here for copy-to-clipboard only and must never be rendered as
  // visible text (shoulder-surf / screenshot / devtools). Only sendPasswordReset
  // sets it.
  | { ok: true; message?: string; resetLink?: string }
  | { ok: false; error: string }
  | { ok: null }

export type InviteServiceHealth =
  | { ok: true; checkedAt: string }
  | {
      ok: false
      reason: "not_configured" | "unauthorized" | "forbidden" | "other"
      status?: number
      detail: string
      checkedAt: string
    }
  | { ok: null }
