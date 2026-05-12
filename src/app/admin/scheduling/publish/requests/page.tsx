import Link from "next/link"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import {
  RequestsClient,
  type CurrentUser,
  type EmployeeLite,
  type PublishRequestRow,
} from "./_components/requests-client"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Publish requests | MFO / Rink Reports",
}

export default async function PublishRequestsPage() {
  const { profile } = await requireAdmin()
  const facilityId = profile?.facility_id ?? null

  if (!profile || !facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No facility yet</CardTitle>
            <CardDescription>
              Create a facility before reviewing publish requests.
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

  // Resolve the current admin's employee id so the client can hide the
  // approve/reject buttons on requests they themselves filed.
  const { data: meEmp } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", profile.id)
    .eq("facility_id", facilityId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{ id: string }>()

  // schedule_publish_requests isn't in generated types yet; cast.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rowsRaw } = await (supabase as any)
    .from("schedule_publish_requests")
    .select(
      "id, facility_id, requested_by_employee_id, range_starts_at, range_ends_at, notes, status, decided_by_employee_id, decided_at, rejection_reason, created_at",
    )
    .eq("facility_id", facilityId)
    .order("created_at", { ascending: false })
    .limit(100)

  const rows = (rowsRaw ?? []) as PublishRequestRow[]

  const empIds = Array.from(
    new Set(
      rows.flatMap((r) =>
        [r.requested_by_employee_id, r.decided_by_employee_id].filter(
          (x): x is string => !!x,
        ),
      ),
    ),
  )

  let employees: EmployeeLite[] = []
  if (empIds.length > 0) {
    const { data } = await supabase
      .from("employees")
      .select("id, first_name, last_name")
      .in("id", empIds)
    employees = (data ?? []) as EmployeeLite[]
  }

  const me: CurrentUser = {
    employeeId: meEmp?.id ?? null,
    isSuperAdmin: profile?.is_super_admin === true,
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Two-person rule</CardTitle>
          <CardDescription>
            Publish requests must be approved by an admin who is NOT the
            requester. RLS and a CHECK constraint enforce this at the database
            level — the UI hides your own requests below as a courtesy.
          </CardDescription>
        </CardHeader>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No publish requests yet</CardTitle>
            <CardDescription>
              File a request from the Shifts view to start the approval flow.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <RequestsClient rows={rows} employees={employees} me={me} />
      )}

      <div className="text-muted-foreground text-xs">
        Showing the 100 most recent requests ·{" "}
        <Link
          href="/admin/scheduling/publish"
          className="text-foreground hover:underline"
        >
          View publish history →
        </Link>
      </div>
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">
        Publish requests
      </h1>
      <p className="text-muted-foreground text-sm">
        Review pending schedule publish requests. Approving immediately moves
        the draft shifts in the window to published.
      </p>
    </div>
  )
}
