import Link from "next/link"

import { PageHeader } from "@/components/ui/page-header"
import { requireUser } from "@/lib/auth"
import { currentUserCan } from "@/lib/permissions/check"
import { createClient } from "@/lib/supabase/server"

import { CalendarClient } from "./_components/calendar-client"
import { NotAvailable } from "./_components/not-available"
import { loadCalendarData, type CalendarSearchParams } from "./_lib/load-calendar"

export const dynamic = "force-dynamic"

export const metadata = { title: "Rink Schedule | MFO / Rink Reports" }

type SearchParams = Promise<CalendarSearchParams>

/**
 * The dashboard rink schedule is a VIEW, deliberately: every scheduling write
 * — creating, moving, resizing, cancelling, series, planned cuts — lives in
 * the admin console at /admin/rink-scheduling/schedule. canCreate/canEdit are
 * pinned false here so no edit affordance ever renders on this page,
 * whatever the account's module grants; the grants still decide what the
 * admin surface (and the server actions behind it) will accept.
 */
export default async function RinkSchedulePage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireUser()
  const supabase = await createClient()

  if (!(await currentUserCan(supabase, "rink_scheduling", "view"))) {
    return <NotAvailable />
  }

  // requireUser() already resolves the caller's OWN profile row scoped by id
  // (see getCurrentUser()). The equivalent unscoped `.from("users").select(...)
  // .maybeSingle()` this replaced broke for every is_super_admin account: the
  // users_select RLS policy grants a super admin every row in the table, so
  // with no `.eq("id", ...)` filter the query matched all of them,
  // `.maybeSingle()` errored on the multi-row result, and the discarded
  // `error` left `data` (and so `facilityId`) null — rendering this exact
  // "not attached to a facility" screen for an account that had a perfectly
  // valid facility_id all along.
  const facilityId = current.profile?.facility_id ?? null
  if (!facilityId) return <NotAvailable reason="no-facility" />

  const params = await searchParams
  const [data, canEdit] = await Promise.all([
    loadCalendarData(supabase, facilityId, params),
    currentUserCan(supabase, "rink_scheduling", "edit"),
  ])

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 py-6">
      <PageHeader
        title="Rink Schedule"
        description="Ice bookings across every surface, read-only. Times are the rink's own local clock."
        actions={
          <>
            {/* Front Desk is view-tier, same as this page. Everything that
                MANAGES the schedule — bookings, series, requests, invoices —
                lives in the admin console, so schedulers get one link there
                instead of a row of edit-tier tools. */}
            <Link
              href="/reports/rink-scheduling/desk"
              className="text-muted-foreground text-sm no-underline hover:underline print:hidden"
            >
              Front Desk →
            </Link>
            {canEdit && (
              <Link
                href="/admin/rink-scheduling/schedule"
                className="text-muted-foreground text-sm no-underline hover:underline print:hidden"
              >
                Manage schedule →
              </Link>
            )}
          </>
        }
      />
      <CalendarClient {...data} canCreate={false} canEdit={false} />
    </div>
  )
}
