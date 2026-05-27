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
import { currentUserCan } from "@/lib/permissions/check"

import { AvailabilityAddToggle } from "../_components/availability-add-toggle"
import { AvailabilityRow } from "../_components/availability-row"
import { DAY_NAMES } from "../types"

export const dynamic = "force-dynamic"

function NotAvailable({
  title,
  description,
  showSignOut = false,
}: {
  title: string
  description: string
  showSignOut?: boolean
}) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports/scheduling" className="hover:underline">
            Scheduling
          </Link>{" "}
          / Availability
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {showSignOut ? (
          <CardContent>
            <SignOutButton />
          </CardContent>
        ) : null}
      </Card>
    </div>
  )
}

export default async function AvailabilityPage() {
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
      <NotAvailable
        title="Account not set up"
        description="Your account isn't fully set up yet. Contact your administrator."
        showSignOut
      />
    )
  }

  if (!(await currentUserCan(supabase, "scheduling", "view"))) {
    return (
      <NotAvailable
        title="No permission"
        description="You don't have access to scheduling yet."
      />
    )
  }

  const { data: rowsRaw } = await supabase
    .from("schedule_availability")
    .select(
      "id, day_of_week, start_time, end_time, availability_type, effective_from, effective_to, notes"
    )
    .eq("employee_id", employeeRow.id)
    .order("day_of_week", { ascending: true })
    .order("start_time", { ascending: true })

  const rows = rowsRaw ?? []
  const grouped = new Map<number, typeof rows>()
  for (const row of rows) {
    const list = grouped.get(row.day_of_week) ?? []
    list.push(row)
    grouped.set(row.day_of_week, list)
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports/scheduling" className="hover:underline">
            Scheduling
          </Link>{" "}
          / Availability
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Availability
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tell your manager when you can or can&apos;t work.
        </p>
      </div>

      <AvailabilityAddToggle />

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardDescription>No availability set</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {DAY_NAMES.map((dayName, idx) => {
            const dayRows = grouped.get(idx) ?? []
            if (dayRows.length === 0) return null
            return (
              <section key={dayName} className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold tracking-tight">
                  {dayName}
                </h2>
                <ul className="flex flex-col divide-y divide-border rounded-xl border bg-card">
                  {dayRows.map((r) => (
                    <li key={r.id}>
                      <AvailabilityRow row={r} />
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
