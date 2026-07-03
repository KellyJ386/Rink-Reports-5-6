import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/ui/page-header"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

type UserRow = {
  id: string
  email: string | null
  full_name: string | null
  is_active: boolean
  is_super_admin: boolean
  facility_id: string | null
}

export const dynamic = "force-dynamic"

export const metadata = { title: "Permissions | MFO / Rink Reports" }

export default async function PermissionsPage() {
  const current = await requireAdmin()
  const supabase = await createClient()

  let query = supabase
    .from("users")
    .select("id, email, full_name, is_active, is_super_admin, facility_id")
    .eq("is_active", true)
    .order("full_name", { ascending: true })
    .limit(500)

  // Explicit facility scope (D-09): a non-super-admin only lists users in their
  // own facility. Super admins list everyone (cross-facility by design). RLS
  // already bounds this, but the filter makes the intent explicit and fails
  // safe if the policy regresses.
  if (!current.profile?.is_super_admin && current.profile?.facility_id) {
    query = query.eq("facility_id", current.profile.facility_id)
  }

  const { data: usersRaw } = await query

  const users = (usersRaw ?? []) as UserRow[]

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Module Access Control"
        description="Per-user permissions for each module. Pick a user to edit their matrix of (module × action) toggles. Users with no row default to zero access."
      />

      {users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active users.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {users.map((u) => {
            const label = u.full_name || u.email || u.id
            const subtitle = u.email && u.full_name ? u.email : null
            return (
              <li key={u.id}>
                <Link
                  href={`/admin/permissions/${u.id}`}
                  className="flex items-center justify-between px-4 py-3 text-card-foreground hover:bg-muted"
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{label}</span>
                    {subtitle && (
                      <span className="text-xs text-muted-foreground">
                        {subtitle}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {u.is_super_admin && (
                      <Badge variant="success">super admin</Badge>
                    )}
                    {!u.facility_id && (
                      <Badge variant="warning">no facility</Badge>
                    )}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
