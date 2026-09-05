import Link from "next/link"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { TabNav } from "@/components/ui/tab-nav"
import { requireAdmin } from "@/lib/auth"
import { currentUserCan } from "@/lib/permissions/check"
import { createClient } from "@/lib/supabase/server"

import { CalendarClient } from "@/app/reports/rink-scheduling/_components/calendar-client"
import {
  loadCalendarData,
  type CalendarSearchParams,
} from "@/app/reports/rink-scheduling/_lib/load-calendar"
import { SCHEDULE_HREF, consoleNavItems } from "../types"

export const dynamic = "force-dynamic"

export const metadata = { title: "Ice Schedule | MFO / Rink Reports" }

type SearchParams = Promise<CalendarSearchParams>

/**
 * The scheduling surface: the same calendar the dashboard shows, with the
 * write affordances on. All ice scheduling happens HERE — the dashboard
 * calendar at /reports/rink-scheduling is a read-only view by design.
 *
 * Gating is layered, not duplicated: the admin layout's requireAdmin gets a
 * caller into the console at all; canCreate/canEdit below decide which
 * affordances render; and every write still lands in the same
 * permission-checked server actions (create/update/cancel re-verify the
 * module submit/edit grant server-side), so this page grants nothing.
 */
export default async function AdminSchedulePage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireAdmin()
  const supabase = await createClient()
  const facilityId = current.profile?.facility_id ?? null

  const nav = (
    <TabNav
      ariaLabel="Rink scheduling sections"
      activeHref={SCHEDULE_HREF}
      items={consoleNavItems()}
    />
  )

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header canEdit={false} />
        {nav}
        <Card>
          <CardHeader>
            <CardTitle>No facility yet</CardTitle>
            <CardDescription>
              Create a facility before scheduling ice.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  const params = await searchParams
  const [data, canView, canCreate, canEdit] = await Promise.all([
    loadCalendarData(supabase, facilityId, params),
    currentUserCan(supabase, "rink_scheduling", "view"),
    currentUserCan(supabase, "rink_scheduling", "submit"),
    currentUserCan(supabase, "rink_scheduling", "edit"),
  ])

  // Console access without the module grant renders a real explanation, not
  // an empty grid: RLS would filter every booking row anyway.
  if (!canView && !canCreate && !canEdit) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header canEdit={false} />
        {nav}
        <Card>
          <CardHeader>
            <CardTitle>Rink Scheduling permission needed</CardTitle>
            <CardDescription>
              This account holds the admin console but no Rink Scheduling
              grant. Add one under Admin → Employees → Permissions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/admin/employees" className="text-sm underline">
              Open Employees
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header canEdit={canEdit} />
      {nav}
      <CalendarClient
        {...data}
        canCreate={canCreate || canEdit}
        canEdit={canEdit}
        basePath={SCHEDULE_HREF}
      />
    </div>
  )
}

function Header({ canEdit }: { canEdit: boolean }) {
  return (
    <PageHeader
      title="Ice Schedule"
      description="Book, move and cancel ice across every surface. Times are the rink's own local clock; staff see this same calendar read-only on their dashboard."
      actions={
        <>
          <Link
            href="/reports/rink-scheduling/desk"
            className="text-muted-foreground text-sm no-underline hover:underline print:hidden"
          >
            Front Desk →
          </Link>
          {canEdit && (
            <>
              <Link
                href="/reports/rink-scheduling/invoices"
                className="text-muted-foreground text-sm no-underline hover:underline print:hidden"
              >
                Invoices →
              </Link>
              <Link
                href="/reports/rink-scheduling/insights"
                className="text-muted-foreground text-sm no-underline hover:underline print:hidden"
              >
                Insights →
              </Link>
              <Link
                href="/reports/rink-scheduling/requests"
                className="text-muted-foreground text-sm no-underline hover:underline print:hidden"
              >
                Requests →
              </Link>
              <Link
                href="/reports/rink-scheduling/contracts"
                className="text-muted-foreground text-sm no-underline hover:underline print:hidden"
              >
                Contracts →
              </Link>
            </>
          )}
        </>
      }
    />
  )
}
