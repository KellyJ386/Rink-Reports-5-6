import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { requireAdmin } from "@/lib/auth"
import {
  MODULE_NAMES,
  USER_ACTIONS,
  type ModuleName,
  type UserAction,
} from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"

import { RoleManager, type ManagedRole } from "./_components/role-manager"
import {
  RolesMatrix,
  type RoleActionDefaults,
  type RoleListItem,
} from "./_components/roles-matrix"

export const dynamic = "force-dynamic"

export const metadata = { title: "Roles | MFO / Rink Reports" }

type SearchParams = Promise<{ facility?: string }>

type RoleRow = {
  id: string
  facility_id: string
  key: string
  display_name: string
  hierarchy_level: number
  is_system: boolean
  is_active: boolean | null
  description: string | null
}

type DefaultsRow = {
  role_id: string
  module_name: string
  action: string
  enabled: boolean
}

export default async function RolesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { profile } = await requireAdmin()
  const params = await searchParams

  const facilityId = profile?.is_super_admin
    ? (params?.facility ?? null)
    : (profile?.facility_id ?? null)

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>
              {profile?.is_super_admin
                ? "Choose a facility"
                : "No facility yet"}
            </CardTitle>
            <CardDescription>
              {profile?.is_super_admin
                ? "Pick a facility to manage role defaults. Pass ?facility=<id> in the URL."
                : "Your account isn't linked to a facility yet. Talk to a super admin."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/admin/facility">Go to Facility Settings</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const supabase = await createClient()

  const [{ data: rolesRaw }, { data: defaultsRaw }] = await Promise.all([
    supabase
      .from("roles")
      .select(
        "id, facility_id, key, display_name, hierarchy_level, is_system, is_active, description",
      )
      .eq("facility_id", facilityId)
      .order("is_active", { ascending: false })
      .order("hierarchy_level", { ascending: true }),
    supabase
      .from("role_permission_defaults")
      .select("role_id, module_name, action, enabled")
      .eq("facility_id", facilityId),
  ])

  const roles = (rolesRaw ?? []) as RoleRow[]
  const defaults = (defaultsRaw ?? []) as DefaultsRow[]

  if (roles.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No roles yet</CardTitle>
            <CardDescription>
              Seed roles from the Employees page before configuring defaults.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/admin/employees">Go to Employees</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const activeRoles = roles.filter((r) => r.is_active !== false)

  const roleList: RoleListItem[] = activeRoles.map((r) => ({
    id: r.id,
    key: r.key,
    display_name: r.display_name,
    hierarchy_level: r.hierarchy_level,
  }))

  const managedRoles: ManagedRole[] = roles.map((r) => ({
    id: r.id,
    key: r.key,
    display_name: r.display_name,
    hierarchy_level: r.hierarchy_level,
    is_system: r.is_system,
    is_active: r.is_active !== false,
    description: r.description,
  }))

  const defaultsMap: RoleActionDefaults = {}
  for (const r of roleList) {
    const modMap = {} as Record<ModuleName, Record<UserAction, boolean>>
    for (const m of MODULE_NAMES) {
      modMap[m] = { view: false, submit: false, edit: false, admin: false }
    }
    defaultsMap[r.id] = modMap
  }
  for (const d of defaults) {
    if (!(MODULE_NAMES as readonly string[]).includes(d.module_name)) continue
    if (!(USER_ACTIONS as readonly string[]).includes(d.action)) continue
    const roleMap = defaultsMap[d.role_id]
    if (!roleMap) continue
    roleMap[d.module_name as ModuleName][d.action as UserAction] = d.enabled
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How permissions resolve</CardTitle>
          <CardDescription>
            For each (employee, module) the system picks the first hit
            from: explicit override → role default → no access. Per-employee
            overrides live in{" "}
            <Link href="/admin/permissions" className="underline">
              Module Access Control
            </Link>
            .
          </CardDescription>
        </CardHeader>
      </Card>
      <RoleManager facilityId={facilityId} roles={managedRoles} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Role permission defaults</CardTitle>
          <CardDescription>
            Toggle the default actions (View / Submit / Edit / Admin) each role
            gets per module. Changes re-apply to that role&apos;s current staff;
            per-employee overrides set in Module Access Control are preserved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RolesMatrix roles={roleList} defaults={defaultsMap} />
        </CardContent>
      </Card>
    </div>
  )
}

function Header() {
  return (
    <PageHeader
      title="Roles"
      description="Manage facility roles and the permission defaults each role grants."
    />
  )
}
