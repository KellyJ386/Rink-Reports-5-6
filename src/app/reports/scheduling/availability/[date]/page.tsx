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

import { AvailabilityAddToggle } from "../../_components/availability-add-toggle"
import { AvailabilityRow } from "../../_components/availability-row"
import { DAY_NAMES, parseDateParam, type JobAreaOption } from "../../types"

export const dynamic = "force-dynamic"

type RouteParams = { date: string }

type AvailabilityRowData = {
  id: string
  day_of_week: number
  start_time: string
  end_time: string
  availability_type: string
  effective_from: string | null
  effective_to: string | null
  notes: string | null
  job_area_id: string | null
}

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
          <Link href="/reports/scheduling/availability" className="hover:underline">
            Availability
          </Link>
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

export default async function AvailabilityDayPage({
  params,
}: {
  params: Promise<RouteParams>
}) {
  const { date: dateParam } = await params
  const date = parseDateParam(dateParam)
  if (!date) {
    return (
      <NotAvailable
        title="Invalid date"
        description="That date isn't valid. Go back and pick a day from the week."
      />
    )
  }
  const dayOfWeek = date.getDay()

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

  // job_area_id isn't in the generated types yet (migration 127); cast.
  const { data: rowsRaw } = await (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase as any
  )
    .from("schedule_availability")
    .select(
      "id, day_of_week, start_time, end_time, availability_type, effective_from, effective_to, notes, job_area_id"
    )
    .eq("employee_id", employeeRow.id)
    .eq("day_of_week", dayOfWeek)
    .order("start_time", { ascending: true })

  const rows = (rowsRaw ?? []) as AvailabilityRowData[]

  // Job areas this employee is assigned to (the picker options + name lookup).
  // employee_job_area_* tables aren't in the generated types; cast.
  const { data: assignmentsRaw } = await (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase as any
  )
    .from("employee_job_area_assignments")
    .select("job_area_id, employee_job_areas(id, name, is_active, sort_order)")
    .eq("employee_id", employeeRow.id)

  type AssignmentRow = {
    job_area_id: string
    employee_job_areas: {
      id: string
      name: string
      is_active: boolean
      sort_order: number
    } | null
  }
  const jobAreas: JobAreaOption[] = ((assignmentsRaw ?? []) as AssignmentRow[])
    .map((a) => a.employee_job_areas)
    .filter((area): area is NonNullable<typeof area> => !!area && area.is_active)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map((area) => ({ id: area.id, name: area.name }))

  const jobAreaNameById = new Map(jobAreas.map((a) => [a.id, a.name]))

  const fullDate = date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports/scheduling" className="hover:underline">
            Scheduling
          </Link>{" "}
          /{" "}
          <Link
            href="/reports/scheduling/availability"
            className="hover:underline"
          >
            Availability
          </Link>{" "}
          / {DAY_NAMES[dayOfWeek]}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{fullDate}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Set when you can work this day and the area / department you want to
          work. This applies to every {DAY_NAMES[dayOfWeek]}.
        </p>
      </div>

      <AvailabilityAddToggle jobAreas={jobAreas} fixedDay={dayOfWeek} />

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardDescription>
              No availability set for {DAY_NAMES[dayOfWeek]} yet.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-xl border bg-card">
          {rows.map((r) => (
            <li key={r.id}>
              <AvailabilityRow
                row={{
                  ...r,
                  job_area_name: r.job_area_id
                    ? jobAreaNameById.get(r.job_area_id) ?? null
                    : null,
                }}
                jobAreas={jobAreas}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
