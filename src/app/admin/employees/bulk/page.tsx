import Link from "next/link"
import { redirect } from "next/navigation"

import { Breadcrumb } from "@/components/ui/breadcrumb"
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
import { createClient } from "@/lib/supabase/server"

import type { RoleRow } from "../types"
import { BulkAddClient } from "./_components/bulk-add-client"

export const dynamic = "force-dynamic"

export const metadata = { title: "Bulk add employees | MFO / Rink Reports" }

type SearchParams = Promise<{ facility?: string }>

export default async function BulkAddEmployeesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireAdmin()
  const profile = current.profile
  const params = await searchParams

  const facilityId = profile?.is_super_admin
    ? (params?.facility ?? null)
    : (profile?.facility_id ?? null)

  // Super admin without a chosen facility, or an unassigned admin: send them
  // back to the employees hub, which handles facility selection / messaging.
  if (!facilityId) {
    redirect("/admin/employees")
  }

  const supabase = await createClient()
  const [{ data: rolesRaw }, { data: emailRaw }] = await Promise.all([
    supabase
      .from("roles")
      .select("id, facility_id, key, display_name, hierarchy_level, is_system")
      .eq("facility_id", facilityId)
      .order("hierarchy_level", { ascending: true }),
    supabase.from("employees").select("email").eq("facility_id", facilityId),
  ])

  const roles = (rolesRaw ?? []) as RoleRow[]
  const existingEmails = (emailRaw ?? [])
    .map((r) => (r.email as string | null)?.trim().toLowerCase())
    .filter((e): e is string => !!e)

  const backHref = profile?.is_super_admin
    ? `/admin/employees?facility=${facilityId}`
    : "/admin/employees"

  if (roles.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header backHref={backHref} />
        <Card>
          <CardHeader>
            <CardTitle>No roles yet</CardTitle>
            <CardDescription>
              Seed the canonical role set on the Employees page before bulk
              adding staff.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={backHref}>Back to Employees</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header backHref={backHref} />
      <BulkAddClient
        facilityId={facilityId}
        roles={roles}
        existingEmails={existingEmails}
      />
    </div>
  )
}

function Header({ backHref }: { backHref: string }) {
  return (
    <PageHeader
      breadcrumb={
        <Breadcrumb
          segments={[
            { label: "Employees", href: backHref },
            { label: "Bulk add" },
          ]}
        />
      }
      title="Bulk add employees"
      description="Add many employees at once — type rows or paste from a spreadsheet. Roles apply their pre-configured permission sets automatically."
    />
  )
}
