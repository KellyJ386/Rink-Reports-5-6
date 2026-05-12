import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireAdmin } from "@/lib/auth"
import { type PermissionLevel } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"

import { MODULE_KEYS, type ModuleKey } from "../permissions/types"
import { RoleManager, type ManagedRole } from "./_components/role-manager"
import {
  RolesMatrix,
  type RoleDefaultsMap,
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
  module_key: string
  permission_level: PermissionLevel
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
    // is_active and description were added in migration 44; cast through any
    // until the generated types catch up.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("roles")
      .select(
        "id, facility_id, key, display_name, hierarchy_level, is_system, is_active, description",
      )
      .eq("facility_id", facilityId)
      .order("is_active", { ascending: false })
      .order("hierarchy_level", { ascending: true }),
    // role_module_permission_defaults isn't in generated types yet; cast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("role_module_permission_defaults")
      .select("role_id, module_key, permission_level")
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

  const defaultsMap: RoleDefaultsMap = {}
  for (const d of defaults) {
    if (!(MODULE_KEYS as readonly string[]).includes(d.module_key)) continue
    const key = d.module_key as ModuleKey
    const existing = defaultsMap[d.role_id] ?? {}
    existing[key] = d.permission_level
    defaultsMap[d.role_id] = existing
  }
  for (const r of roleList) {
    if (!defaultsMap[r.id]) defaultsMap[r.id] = {}
    for (const k of MODULE_KEYS) {
      if (!defaultsMap[r.id]![k]) defaultsMap[r.id]![k] = "none"
    }
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How permissions resolve</CardTitle>
          <CardDescription>
            For each (employee, module) the system picks the first hit from:
            explicit override → role default → MAX(department default) →
            facility default → no access. Per-employee overrides live in{" "}
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
            Set the default permission level each role gets per module.
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
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Roles</h1>
      <p className="text-muted-foreground text-sm">
        Manage facility roles and the permission defaults each role grants.
      </p>
    </div>
  )
}
