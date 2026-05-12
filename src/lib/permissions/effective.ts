import "server-only"

import { createClient } from "@/lib/supabase/server"

import { type PermissionLevel } from "./levels"

export async function getEffectiveModulePermission(
  employeeId: string,
  moduleKey: string,
): Promise<PermissionLevel> {
  const supabase = await createClient()
  // effective_module_permission() is not yet in the generated types; cast.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).rpc("effective_module_permission", {
    p_employee_id: employeeId,
    p_module_key: moduleKey,
  })
  return (data as PermissionLevel | null) ?? "none"
}

export async function getCurrentEmployeeModulePermission(
  moduleKey: string,
): Promise<PermissionLevel> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).rpc(
    "current_employee_module_permission",
    { p_module_key: moduleKey },
  )
  return (data as PermissionLevel | null) ?? "none"
}
