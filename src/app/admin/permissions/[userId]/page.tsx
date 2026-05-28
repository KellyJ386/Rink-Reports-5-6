import Link from "next/link"
import { notFound } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { requireAdmin } from "@/lib/auth"
import {
  matrixFromRows,
  type UserAction,
  type ModuleName,
} from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"

import { PermissionMatrix } from "../_components/permission-matrix"

type PermissionRow = {
  user_id: string
  facility_id: string
  module_name: ModuleName
  action: UserAction
  enabled: boolean
}

export default async function UserPermissionsPage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  await requireAdmin()
  const { userId } = await params
  const supabase = await createClient()

  const { data: userRow } = await supabase
    .from("users")
    .select("id, email, full_name, facility_id, is_super_admin")
    .eq("id", userId)
    .maybeSingle()

  if (!userRow) notFound()

  const label = userRow.full_name || userRow.email || userId

  if (!userRow.facility_id) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="space-y-4 rounded-lg border border-border bg-card p-6 text-card-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">Permissions for {label}</h2>
            {userRow.is_super_admin && (
              <Badge variant="success">super admin</Badge>
            )}
            <Badge variant="warning">no facility</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            This user has no facility assigned yet. Assign one from the{" "}
            <Link
              href="/admin/employees"
              className="font-medium text-foreground underline underline-offset-2"
            >
              Users / Employees
            </Link>{" "}
            page before editing module permissions.
          </p>
          <p className="text-xs text-muted-foreground">
            Permissions are scoped to a facility, so there&apos;s no place to
            store toggles for this user yet.
          </p>
          <Link
            href="/admin/permissions"
            className="inline-block text-sm font-medium text-foreground underline underline-offset-2"
          >
            ← Back to users
          </Link>
        </div>
      </div>
    )
  }

  const { data: rows } = await supabase
    .from("user_permissions")
    .select("user_id, facility_id, module_name, action, enabled")
    .eq("user_id", userId)
    .eq("facility_id", userRow.facility_id)

  const matrix = matrixFromRows((rows ?? []) as unknown as PermissionRow[])

  const notice = userRow.is_super_admin ? (
    <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
      <span className="font-medium">Super admin</span> — this user bypasses
      module permissions automatically. Toggles below only matter if their
      super-admin flag is removed.
    </div>
  ) : null

  return (
    <div className="mx-auto max-w-5xl p-6">
      <PermissionMatrix
        userId={userId}
        facilityId={userRow.facility_id}
        userLabel={label}
        initialMatrix={matrix}
        notice={notice}
      />
    </div>
  )
}
