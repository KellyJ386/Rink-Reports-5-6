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
import {
  RolesMatrix,
  type RoleDefaultsMap,
  type RoleListItem,
} from "./_components/roles-matrix"

export const dynamic = "force-dynamic"

export const metadata = { title: "Role Defaults | MFO / Rink Reports" }

type SearchParams = Promise<{ facility?: string }>

type RoleRow = {
  id: string
  facility_id: string
  key: string
  display_name: string
  hierarchy_level: number
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
    supabase
      .from("roles")
      .select("id, facility_id, key, display_name, hierarchy_level")
      .eq("facility_id", facilityId)
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

  const roleList: RoleListItem[] = roles.map((r) => ({
    id: r.id,
    key: r.key,
    display_name: r.display_name,
    hierarchy_level: r.hierarchy_level,
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
          <CardTitle className="text-base">How defaults work</CardTitle>
          <CardDescription>
            These levels are the fallback for any employee whose own row in{" "}
            <Link href="/admin/permissions" className="underline">
              Module Access Control
            </Link>{" "}
            doesn&apos;t override them. Per-employee overrides always win.
          </CardDescription>
        </CardHeader>
      </Card>
      <RolesMatrix roles={roleList} defaults={defaultsMap} />
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Role Defaults</h1>
      <p className="text-muted-foreground text-sm">
        Set the default permission level each role gets per module. Employees
        without an explicit override inherit these.
      </p>
    </div>
  )
}
