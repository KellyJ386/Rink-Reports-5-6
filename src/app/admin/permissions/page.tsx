import Link from "next/link"

import { Badge } from "@/components/ui/badge"
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
  await requireAdmin()
  const supabase = await createClient()

  const { data: usersRaw } = await supabase
    .from("users")
    .select("id, email, full_name, is_active, is_super_admin, facility_id")
    .eq("is_active", true)
    .order("full_name", { ascending: true })
    .limit(500)

  const users = (usersRaw ?? []) as UserRow[]

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Module Access Control
        </h1>
        <p className="text-sm text-muted-foreground">
          Per-user permissions for each module. Pick a user to edit their
          matrix of (module &times; action) toggles. Users with no row default
          to zero access.
        </p>
      </header>

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
