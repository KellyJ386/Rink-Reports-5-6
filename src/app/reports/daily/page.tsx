import Link from "next/link"

import { SignOutButton } from "@/components/staff/sign-out-button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { AreasGrid, type AreaCard } from "./_components/areas-grid"

export const dynamic = "force-dynamic"

export default async function DailyReportsAreaPickerPage() {
  const current = await requireUser()
  const supabase = await createClient()

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  if (!employeeRow) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Account not ready</CardTitle>
            <CardDescription>
              Your account is being set up. Contact your administrator.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignOutButton />
          </CardContent>
        </Card>
      </div>
    )
  }

  // Pull all areas in the user's facility (RLS will restrict to allowed rows).
  const { data: allAreas } = await supabase
    .from("daily_report_areas")
    .select("id, slug, name, color, sort_order, is_active, facility_id")
    .eq("facility_id", employeeRow.facility_id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })

  // Find which of those areas the staff has can_submit on.
  const { data: perms } = await supabase
    .from("module_area_permissions")
    .select("area_id, can_submit")
    .eq("module_key", "daily_reports")
    .eq("employee_id", employeeRow.id)

  const submittableAreaIds = new Set(
    (perms ?? []).filter((p) => p.can_submit).map((p) => p.area_id)
  )

  const accessible: AreaCard[] = (allAreas ?? [])
    .filter((a) => submittableAreaIds.has(a.id))
    .map((a) => ({
      id: a.id,
      slug: a.slug,
      name: a.name,
      color: a.color,
    }))

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/reports" className="hover:underline">
              Reports
            </Link>{" "}
            / Daily Reports
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Pick an area
          </h1>
        </div>
      </div>

      {accessible.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No areas assigned</CardTitle>
            <CardDescription>
              No daily report areas have been assigned to you yet. Talk to your
              supervisor.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <AreasGrid areas={accessible} />
      )}
    </div>
  )
}
