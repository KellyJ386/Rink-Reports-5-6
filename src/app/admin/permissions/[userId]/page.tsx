import { notFound } from "next/navigation"

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
    .select("id, email, full_name, facility_id")
    .eq("id", userId)
    .maybeSingle()

  if (!userRow || !userRow.facility_id) notFound()

  const { data: rows } = await supabase
    // user_permissions isn't in generated types yet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("user_permissions" as any)
    .select("user_id, facility_id, module_name, action, enabled")
    .eq("user_id", userId)
    .eq("facility_id", userRow.facility_id)

  const matrix = matrixFromRows((rows ?? []) as unknown as PermissionRow[])
  const label = userRow.full_name || userRow.email || userId

  return (
    <div className="mx-auto max-w-5xl p-6">
      <PermissionMatrix
        userId={userId}
        facilityId={userRow.facility_id}
        userLabel={label}
        initialMatrix={matrix}
      />
    </div>
  )
}
