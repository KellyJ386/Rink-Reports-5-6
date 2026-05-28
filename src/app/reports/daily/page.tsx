import { SignOutButton } from "@/components/staff/sign-out-button"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { AreasGrid, type AreaCard } from "./_components/areas-grid"
import { getAllowedDailyAreas } from "./actions"

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

  // Areas this user may submit to (per-area can_submit). Shared with the
  // server-side RLS boundary via getAllowedDailyAreas().
  const accessible: AreaCard[] = await getAllowedDailyAreas()

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <PageHeader
        variant="display"
        module="daily"
        breadcrumb={
          <Breadcrumb
            segments={[
              { label: "Reports", href: "/reports" },
              { label: "Daily Reports" },
            ]}
          />
        }
        eyebrow="Staff report"
        title="Pick an area"
        description="Choose an area to submit today's daily report."
      />


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
